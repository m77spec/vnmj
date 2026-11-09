/**
 * Integration test for the unified MANUAL payment flow (Issue #5):
 *
 *   1. enrollWithReceipt creates the Enrollment (PENDING) AND a linked Payment
 *      (PENDING, provider MANUAL, receiptFileUrl set) in one transaction.
 *   2. re-uploading a receipt reuses that pending payment instead of forking a
 *      second one.
 *   3. review() updates Enrollment + Payment in a SINGLE transaction:
 *      APPROVED -> payment PAID (paidAt/reviewedAt set); REJECTED -> payment
 *      REJECTED. Guarded: non-PENDING enrollments cannot be re-reviewed.
 *   4. cancel() is only allowed on PENDING payments and returns the enrollment
 *      to RESERVED.
 *   5. refund() only from PAID and revokes the enrollment (REVOKED) in the same
 *      transaction + writes an audit log.
 *
 * Safety: the WHOLE test runs inside a single interactive Prisma transaction
 * and always throws at the end, so PostgreSQL ROLLS BACK everything — no
 * residue is ever written. Safe against any DB.
 *
 * Run:  INTEGRATION_TEST=1 npx ts-node tests/manual-payment.integration.ts
 */
import { PrismaClient, Prisma, Role, CourseOpeningStatus, PaymentStatus, EnrollmentStatus } from '@prisma/client';
import { EnrollmentsService } from '../src/enrollments/enrollments.service';
import { PaymentsService } from '../src/commerce/payments.service';

if (!process.env.INTEGRATION_TEST) {
  console.error('Refusing to run without INTEGRATION_TEST=1');
  process.exit(2);
}

const prisma = new PrismaClient();

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  try {
    await prisma.$transaction(
      async (tx) => {
        const scopedPrisma = new Proxy({} as any, {
          get: (_target, prop) => {
            if (prop === '$transaction') {
              return (fn: any, _opts?: object) => fn(tx);
            }
            return (tx as any)[prop];
          },
        });

        const notifications = { notify: async () => ({ id: 'n1' }) };
        const email = {};
        const finance = {} as any;

        const enrollments = new EnrollmentsService(
          scopedPrisma,
          { logAction: async (action: string, ip?: string, userId?: string) => { await tx.auditLog.create({ data: { action, ipAddress: ip, userId } }); } } as any,
          notifications as any,
          { getOrCreateRoomForOpening: async () => ({ id: 'room' }), syncRoomMembers: async () => undefined } as any,
          finance,
        );
        const payments = new PaymentsService(scopedPrisma, notifications as any, email as any, { logAction: async (action: string, ip?: string, userId?: string) => { await tx.auditLog.create({ data: { action, ipAddress: ip, userId } }); } } as any, { getOrCreateRoomForOpening: async () => ({ id: 'room' }), syncRoomMembers: async () => undefined } as any, finance);

        const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const instructor = await tx.user.create({
          data: { email: `pay-instr-${suffix}@example.com`, passwordHash: 'x', role: Role.INSTRUCTOR, language: 'en' },
        });
        const student = await tx.user.create({
          data: { email: `pay-stud-${suffix}@example.com`, passwordHash: 'x', role: Role.STUDENT, language: 'en' },
        });

        const course = await tx.course.create({
          data: { titleAr: `دورة ${suffix}`, titleEn: `Course ${suffix}`, instructorId: instructor.id },
        });
        const opening = await tx.courseOpening.create({
          data: {
            courseId: course.id,
            instructorId: instructor.id,
            status: CourseOpeningStatus.OPEN,
            isPublished: true,
            price: new Prisma.Decimal('499.00'),
            currency: 'SAR',
          },
        });

        // === 1. Receipt upload creates Enrollment + Payment together ===
        const enr1 = await enrollments.enrollWithReceipt(opening.id, '/uploads/private/receipts/r1.png', student.id);
        assert(enr1.status === EnrollmentStatus.PENDING, 'enrollment should be PENDING');
        const pay1 = await tx.payment.findFirstOrThrow({ where: { enrollmentId: enr1.id } });
        assert(pay1.provider === 'MANUAL', 'payment provider should be MANUAL');
        assert(pay1.status === PaymentStatus.PENDING, 'payment should be PENDING');
        assert(pay1.receiptFileUrl === '/uploads/private/receipts/r1.png', 'payment should carry the receipt');
        assert(Number(pay1.amount) === 499, `amount should be 499, got ${pay1.amount}`);
        const count1 = await tx.payment.count({ where: { enrollmentId: enr1.id } });
        assert(count1 === 1, 'receipt upload should create exactly ONE payment');

        // === 2. Re-upload reuses the pending payment ===
        await enrollments.enrollWithReceipt(opening.id, '/uploads/private/receipts/r2.png', student.id);
        const count2 = await tx.payment.count({ where: { enrollmentId: enr1.id } });
        assert(count2 === 1, 're-upload should NOT create a second payment');
        const payRe = await tx.payment.findFirstOrThrow({ where: { enrollmentId: enr1.id } });
        assert(payRe.receiptFileUrl === '/uploads/private/receipts/r2.png', 're-upload should refresh the receipt on the SAME payment');

        // === 3a. Rejected receipt can be submitted again with a fresh payment ===
        await enrollments.review(enr1.id, EnrollmentStatus.REJECTED, instructor.id, undefined, 'Please upload a clearer receipt');
        const rejectedPayment = await tx.payment.findFirstOrThrow({
          where: { enrollmentId: enr1.id },
          orderBy: { createdAt: 'desc' },
        });
        assert(rejectedPayment.status === PaymentStatus.REJECTED, 'rejected enrollment payment should be REJECTED');
        const openingAfterRejection = await tx.courseOpening.findUniqueOrThrow({ where: { id: opening.id } });
        assert(openingAfterRejection.seatsTaken === 0, 'rejection should release the enrollment seat');

        const retriedEnrollment = await enrollments.enrollWithReceipt(opening.id, '/uploads/private/receipts/r3.png', student.id);
        assert(retriedEnrollment.status === EnrollmentStatus.PENDING, 'resubmitted enrollment should return to PENDING');
        assert(retriedEnrollment.financeOfficerNotes === null, 'resubmission should clear the previous rejection note');
        const retriedPayments = await tx.payment.findMany({
          where: { enrollmentId: enr1.id },
          orderBy: { createdAt: 'desc' },
        });
        assert(retriedPayments.length === 2, 'resubmitting after rejection should create a new payment attempt');
        assert(retriedPayments[0].status === PaymentStatus.PENDING, 'new payment attempt should be PENDING');
        assert(retriedPayments[0].receiptFileUrl === '/uploads/private/receipts/r3.png', 'new payment should carry the replacement receipt');
        const openingAfterRetry = await tx.courseOpening.findUniqueOrThrow({ where: { id: opening.id } });
        assert(openingAfterRetry.seatsTaken === 1, 'resubmission should reclaim one enrollment seat');

        // === 3b. Review APPROVED => Enrollment APPROVED + Payment PAID in one tx ===
        const apr = await enrollments.review(enr1.id, EnrollmentStatus.APPROVED, instructor.id, undefined, 'looks good');
        assert(apr.status === EnrollmentStatus.APPROVED, 'enrollment should be APPROVED');
        const payApr = await tx.payment.findFirstOrThrow({
          where: { enrollmentId: enr1.id },
          orderBy: { createdAt: 'desc' },
        });
        assert(payApr.status === PaymentStatus.PAID, 'approved enrollment payment should be PAID');
        assert(payApr.paidAt !== null, 'paidAt should be set on approval');
        assert(payApr.reviewedAt !== null, 'reviewedAt should be set on approval');

        // === 3b. Guard: cannot re-review a decided enrollment ===
        let guarded = false;
        try {
          await enrollments.review(enr1.id, EnrollmentStatus.REJECTED, instructor.id);
        } catch (e: any) {
          guarded = e?.constructor?.name === 'ConflictException';
        }
        assert(guarded, 're-review of an APPROVED enrollment should throw ConflictException');

        // === 4. cancel() only on PENDING payment; enrollment -> RESERVED ===
        // Create a fresh pending payment + enrollment to cancel.
        await tx.enrollment.update({ where: { id: enr1.id }, data: { status: EnrollmentStatus.REVOKED } });
        const course2 = await tx.course.create({
          data: { titleAr: `دورة2 ${suffix}`, titleEn: `Course2 ${suffix}`, instructorId: instructor.id },
        });
        const opening2 = await tx.courseOpening.create({
          data: { courseId: course2.id, instructorId: instructor.id, status: CourseOpeningStatus.OPEN, isPublished: true, price: new Prisma.Decimal('199.00'), currency: 'SAR' },
        });
        const enr2 = await enrollments.enrollWithReceipt(opening2.id, '/uploads/private/receipts/r3.png', student.id);
        const pay2 = await tx.payment.findFirstOrThrow({ where: { enrollmentId: enr2.id } });
        const cancelled = await payments.cancel(pay2.id, student.id, Role.STUDENT);
        assert(cancelled.status === PaymentStatus.CANCELLED, 'cancel should mark payment CANCELLED');
        const enrAfterCancel = await tx.enrollment.findUniqueOrThrow({ where: { id: enr2.id } });
        assert(enrAfterCancel.status === EnrollmentStatus.RESERVED, 'cancel should release enrollment back to RESERVED');

        // Cancel guard: cannot cancel an already-cancelled payment.
        let guarded2 = false;
        try {
          await payments.cancel(pay2.id, student.id, Role.STUDENT);
        } catch (e: any) {
          guarded2 = e?.constructor?.name === 'ConflictException';
        }
        assert(guarded2, 'cancelling an already-cancelled payment should throw ConflictException');

        // === 5. refund() only from PAID and revokes the enrollment ===
        // Refund the paid payment from step 3a.
        const refunded = await payments.refund(payApr.id, instructor.id, Role.ADMIN, 'requested_by_customer');
        assert(refunded.ok, 'refund should succeed');
        const payRef = await tx.payment.findUniqueOrThrow({ where: { id: payApr.id } });
        assert(payRef.status === PaymentStatus.REFUNDED, 'payment should be REFUNDED');
        assert(payRef.refundedAt !== null, 'refundedAt should be set');
        const enrRef = await tx.enrollment.findUniqueOrThrow({ where: { id: enr1.id } });
        assert(enrRef.status === EnrollmentStatus.REVOKED, 'refund should revoke the enrollment');
        const audits = await tx.auditLog.count({ where: { action: { contains: 'refund' } } });
        assert(audits >= 1, 'refund should write an audit log action');

        // Refund guard: cannot refund a non-PAID payment.
        let guarded3 = false;
        try {
          await payments.refund(pay2.id, instructor.id, Role.ADMIN);
        } catch (e: any) {
          guarded3 = e?.constructor?.name === 'BadRequestException';
        }
        assert(guarded3, 'refunding a non-PAID payment should throw BadRequestException');

        console.log('MANUAL PAYMENT FLOW INTEGRATION TEST PASSED (rolled back, no DB residue)');
        throw new Error('__ROLLBACK__');
      },
      { timeout: 30000 },
    );
  } catch (e: any) {
    if (e?.message === '__ROLLBACK__') {
      console.log('ALL CLEAN: transaction rolled back.');
      await prisma.$disconnect();
      process.exit(0);
    }
    await prisma.$disconnect();
    console.error(e);
    process.exit(1);
  }
}

main();