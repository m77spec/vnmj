/**
 * Integration test for capacity + webhook atomicity/idempotency (Ref# 7, 9):
 *
 *   1. Concurrent receipt enrollments on a maxStudents=1 opening: exactly ONE
 *      wins the atomic seat claim; the other gets CapacityConflictException.
 *   2. Stripe webhook for a legit payment settles atomically: payment PAID,
 *      enrollment APPROVED, seat claimed, WebhookEvent recorded.
 *   3. Duplicate delivery of the same Stripe event id is short-circuited
 *      (idempotent) — payment not re-processed, seat not double-claimed.
 *   4. Payment that overflows a full opening is AUTO-REFUNDED (payment
 *      REFUNDED + Stripe refund call) and never leaves a paid-but-seatless
 *      enrollment. Uses a REAL second transaction, like production.
 *   5. providerRef mismatch is refused without recording the event.
 *   6. Optional 1,000-user enrollment stress run, measuring database transaction
 *      latency on a single popular opening.
 *
 * Usage/deployment: runs against a throwaway DB (Docker Postgres on :5439).
 * All rows are created with a unique `suffix` and DELETED in the cleanup step,
 * so nothing is left behind even on the production DB.
 *
 * Run:  DATABASE_URL=... INTEGRATION_TEST=1 npx ts-node tests/capacity-webhook.integration.ts
 * Stress: set CONCURRENCY_STRESS=1 to run the 1,000-user case (test DB only).
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

function makePaymentsService(stripeMock: any) {
  const payments = new PaymentsService(
    prisma as any,
    { notify: async () => ({ id: 'n1' }) } as any,
    {} as any,
    { logAction: async () => undefined } as any,
    { getOrCreateRoomForOpening: async () => ({ id: 'room' }), syncRoomMembers: async () => undefined } as any,
    {} as any,
  );
  (payments as any).stripe = stripeMock;
  return payments;
}

function makeEnrollmentsService() {
  return new EnrollmentsService(
    prisma as any,
    { logAction: async () => undefined } as any,
    { notify: async () => ({ id: 'n1' }) } as any,
    { getOrCreateRoomForOpening: async () => ({ id: 'room' }), syncRoomMembers: async () => undefined } as any,
    {} as any,
  );
}

const createdIds = { users: [] as string[], courses: [] as string[], openings: [] as string[], enrollments: [] as string[], payments: [] as string[] };

async function cleanup() {
  await prisma.webhookEvent.deleteMany({ where: { paymentId: { in: createdIds.payments } } }).catch(() => {});
  await prisma.certificate.deleteMany({ where: { studentId: { in: createdIds.users } } }).catch(() => {});
  await prisma.payment.deleteMany({ where: { id: { in: createdIds.payments } } }).catch(() => {});
  await prisma.payment.deleteMany({ where: { studentId: { in: createdIds.users } } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { id: { in: createdIds.enrollments } } }).catch(() => {});
  await prisma.enrollment.deleteMany({ where: { studentId: { in: createdIds.users } } }).catch(() => {});
  await prisma.courseOpening.deleteMany({ where: { id: { in: createdIds.openings } } }).catch(() => {});
  await prisma.course.deleteMany({ where: { id: { in: createdIds.courses } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: createdIds.users } } }).catch(() => {});
}

async function main() {
  try {
    if (process.env.CONCURRENCY_STRESS === '1') {
      const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
      const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
      if (!localHosts.has(databaseUrl.hostname) && process.env.ALLOW_NONLOCAL_CONCURRENCY_STRESS !== '1') {
        throw new Error('Concurrency stress test refused: use a local test database or explicitly set ALLOW_NONLOCAL_CONCURRENCY_STRESS=1.');
      }
    }

    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const instructor = await prisma.user.create({
      data: { email: `cap-instr-${suffix}@example.com`, passwordHash: 'x', role: Role.INSTRUCTOR, language: 'en' },
    });
    createdIds.users.push(instructor.id);

    const makeStudent = async (n: number) => {
      const s = await prisma.user.create({
        data: { email: `cap-stud-${n}-${suffix}@example.com`, passwordHash: 'x', role: Role.STUDENT, language: 'en' },
      });
      createdIds.users.push(s.id);
      return s;
    };

    const makeOpening = async (courseTitle: string, maxStudents: number | null) => {
      const course = await prisma.course.create({
        data: { titleAr: `سعة ${courseTitle}`, titleEn: `Cap ${courseTitle}`, instructorId: instructor.id },
      });
      createdIds.courses.push(course.id);
      const opening = await prisma.courseOpening.create({
        data: {
          courseId: course.id,
          instructorId: instructor.id,
          status: CourseOpeningStatus.OPEN,
          isPublished: true,
          price: new Prisma.Decimal('100.00'),
          currency: 'SAR',
          maxStudents,
        },
      });
      createdIds.openings.push(opening.id);
      return { course, opening };
    };

    const trackEnrollment = (e: { id: string }) => createdIds.enrollments.push(e.id);
    const trackPayment = (id: string) => createdIds.payments.push(id);

    // ========= 1. Concurrent receipt enrollments on the last seat =========
    const { course: capCourse, opening: capOpening } = await makeOpening('one-seat', 1);
    const sA = await makeStudent(1);
    const sB = await makeStudent(2);
    const enrollSvc = makeEnrollmentsService();

    const [resA, resB] = await Promise.allSettled([
      enrollSvc.enrollWithReceipt(capOpening.id, '/uploads/private/receipts/a.png', sA.id),
      enrollSvc.enrollWithReceipt(capOpening.id, '/uploads/private/receipts/b.png', sB.id),
    ]);
    const winners = [resA, resB].filter((r) => r.status === 'fulfilled');
    assert(winners.length === 1, `exactly ONE concurrent enrollment should win, got ${winners.length}`);
    if (resB.status === 'rejected') {
      const name = (resB.reason as any)?.constructor?.name;
      assert(
        name === 'CapacityConflictException' || name === 'ConflictException',
        `loser must be capacity-rejected, got ${name}`,
      );
    }
    const enrolled = await prisma.enrollment.findMany({ where: { courseId: capCourse.id } });
    assert(enrolled.length === 1, `only ONE enrollment should survive, got ${enrolled.length}`);
    const capAfter = await prisma.courseOpening.findUniqueOrThrow({ where: { id: capOpening.id } });
    assert(capAfter.seatsTaken === 1, `seatsTaken must be 1, got ${capAfter.seatsTaken}`);
    winners.forEach((w) => w.status === 'fulfilled' && trackEnrollment(w.value));
    console.log('[capacity] concurrent registration on last seat: 1 winner, 1 capacity-rejected');

    if (process.env.CONCURRENCY_STRESS === '1') {
      const concurrency = Number(process.env.CONCURRENCY_STRESS_USERS ?? 1000);
      const p95TargetMs = Number(process.env.CONCURRENCY_STRESS_P95_MS ?? 2000);
      assert(Number.isInteger(concurrency) && concurrency >= 1000 && concurrency <= 5000, 'CONCURRENCY_STRESS_USERS must be between 1000 and 5000');
      assert(Number.isFinite(p95TargetMs) && p95TargetMs > 0, 'CONCURRENCY_STRESS_P95_MS must be greater than zero');

      const { course, opening } = await makeOpening(`stress-${concurrency}`, concurrency);
      const students = await Promise.all(
        Array.from({ length: concurrency }, (_, index) => makeStudent(index + 10_000)),
      );
      const latencies: number[] = [];
      const results = await Promise.allSettled(students.map(async (student, index) => {
        const startedAt = performance.now();
        const result = await enrollSvc.enrollWithReceipt(
          opening.id,
          `/uploads/private/receipts/stress-${index}.png`,
          student.id,
        );
        latencies.push(performance.now() - startedAt);
        return result;
      }));

      const successful = results.filter((result) => result.status === 'fulfilled');
      const failed = results.filter((result) => result.status === 'rejected');
      assert(
        failed.length === 0,
        `${failed.length}/${concurrency} concurrent enrollments failed: ${failed.slice(0, 3).map((result) => String((result as PromiseRejectedResult).reason)).join('; ')}`,
      );
      successful.forEach((result) => result.status === 'fulfilled' && trackEnrollment(result.value));

      const actualEnrollments = await prisma.enrollment.count({ where: { courseId: course.id } });
      const actualOpening = await prisma.courseOpening.findUniqueOrThrow({ where: { id: opening.id } });
      assert(actualEnrollments === concurrency, `expected ${concurrency} enrollments, got ${actualEnrollments}`);
      assert(actualOpening.seatsTaken === concurrency, `expected ${concurrency} claimed seats, got ${actualOpening.seatsTaken}`);

      latencies.sort((a, b) => a - b);
      const p95Ms = latencies[Math.ceil(latencies.length * 0.95) - 1];
      console.log(`[capacity] ${concurrency} concurrent enrollments: p95=${p95Ms.toFixed(0)}ms; target=${p95TargetMs}ms`);
      assert(p95Ms <= p95TargetMs, `p95 latency ${p95Ms.toFixed(0)}ms exceeded ${p95TargetMs}ms`);
    }

    // ========= 2-5. Stripe webhook atomicity & idempotency =========
    // One seat: stud1 fills it, stud2's later payment must overflow.
    const { course: wbCourse, opening: wbOpening } = await makeOpening('webhook-1seat', 1);
    const stud1 = await makeStudent(3);
    const stud2 = await makeStudent(4);

    const pay = await prisma.payment.create({
      data: {
        studentId: stud1.id,
        openingId: wbOpening.id,
        amount: new Prisma.Decimal('250.00'),
        currency: 'SAR',
        provider: 'STRIPE',
        method: 'CARD',
        status: PaymentStatus.PENDING,
        providerRef: 'pi_legit_1',
        description: 'Stripe checkout test',
      },
    });
    trackPayment(pay.id);

    const refundCalls: string[] = [];
    const stripeMock = {
      webhooks: {
        constructEvent: (raw: string, _sig: string) => {
          const parsed = JSON.parse(raw);
          return {
            id: parsed.id,
            type: parsed.type,
            data: { object: { id: parsed.intentId, amount: parsed.amountCents, currency: parsed.currency, metadata: { paymentId: parsed.paymentId } } },
          };
        },
      },
      refunds: { create: async (arg: { payment_intent: string }) => { refundCalls.push(arg.payment_intent); return { id: 're_' + arg.payment_intent }; } },
    };
    const paymentsSvc = makePaymentsService(stripeMock);

    const successEvent = (paymentId: string, intentId: string, amountCents: number, currency: string, id = 'evt_' + intentId) =>
      JSON.stringify({ id, type: 'payment_intent.succeeded', paymentId, intentId, amountCents, currency });

    // 2. Legit settlement: PAID + APPROVED + seat + WebhookEvent.
    const res1 = await paymentsSvc.webhookStripe(Buffer.from(successEvent(pay.id, 'pi_legit_1', 25000, 'sar')), 'sig');
    assert(res1.received === true, 'first webhook should be received');
    const payAfter = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
    assert(payAfter.status === PaymentStatus.PAID, `payment should be PAID, got ${payAfter.status}`);
    assert(payAfter.paidAt !== null, 'paidAt should be set');
    const enrAfter = await prisma.enrollment.findUniqueOrThrow({ where: { studentId_courseId: { studentId: stud1.id, courseId: wbCourse.id } } });
    trackEnrollment(enrAfter);
    assert(enrAfter.status === EnrollmentStatus.APPROVED, `enrollment should be APPROVED, got ${enrAfter.status}`);
    const openingAfter = await prisma.courseOpening.findUniqueOrThrow({ where: { id: wbOpening.id } });
    assert(openingAfter.seatsTaken === 1, `opening seatsTaken should be 1, got ${openingAfter.seatsTaken}`);
    const evCount = await prisma.webhookEvent.count({ where: { id: 'evt_pi_legit_1' } });
    assert(evCount === 1, `exactly one WebhookEvent should exist, got ${evCount}`);
    console.log('[webhook] legit payment settled atomically (PAID + APPROVED + seat claimed)');

    // 3. Duplicate delivery: idempotent, nothing double-applied.
    const res2 = await paymentsSvc.webhookStripe(Buffer.from(successEvent(pay.id, 'pi_legit_1', 25000, 'sar')), 'sig');
    assert(res2.idempotent === true, 'duplicate must be idempotent');
    const evCount2 = await prisma.webhookEvent.count({ where: { id: 'evt_pi_legit_1' } });
    assert(evCount2 === 1, 'duplicate must NOT record a second WebhookEvent');
    const openingAfter2 = await prisma.courseOpening.findUniqueOrThrow({ where: { id: wbOpening.id } });
    assert(openingAfter2.seatsTaken === 1, `duplicate must NOT re-claim the seat, got ${openingAfter2.seatsTaken}`);
    assert(refundCalls.length === 0, 'duplicate must NOT trigger a refund');
    console.log('[webhook] duplicate Stripe event idempotently short-circuited');

    // 4. Overflow a full opening: auto-refund (uses a REAL second transaction).
    const pay2 = await prisma.payment.create({
      data: {
        studentId: stud2.id,
        openingId: wbOpening.id,
        amount: new Prisma.Decimal('250.00'),
        currency: 'SAR',
        provider: 'STRIPE',
        method: 'CARD',
        status: PaymentStatus.PENDING,
        providerRef: 'pi_overflow_1',
        description: 'Overflow test',
      },
    });
    trackPayment(pay2.id);
    const res3 = await paymentsSvc.webhookStripe(Buffer.from(successEvent(pay2.id, 'pi_overflow_1', 25000, 'sar')), 'sig');
    assert(res3.action === 'auto_refunded_capacity', `overflow must auto-refund, got ${JSON.stringify(res3)}`);
    const pay2After = await prisma.payment.findUniqueOrThrow({ where: { id: pay2.id } });
    assert(pay2After.status === PaymentStatus.REFUNDED, `overflow payment must be REFUNDED, got ${pay2After.status}`);
    assert(pay2After.refundedAt !== null, 'refundedAt should be set on auto-refund');
    assert(refundCalls.includes('pi_overflow_1'), 'Stripe refund.create must be called for the overflow intent');
    const noEnr2 = await prisma.enrollment.findFirst({ where: { studentId: stud2.id, courseId: wbCourse.id } });
    assert(!noEnr2, 'overflow must NOT create an enrollment');
    const openingAfter3 = await prisma.courseOpening.findUniqueOrThrow({ where: { id: wbOpening.id } });
    assert(openingAfter3.seatsTaken === 1, `overflow must NOT consume a seat, got ${openingAfter3.seatsTaken}`);
    console.log('[webhook] overflow auto-refunded; no paid seatless enrollment');

    // 5. providerRef mismatch: refuse, no record, no refund.
    const pay3 = await prisma.payment.create({
      data: {
        studentId: stud2.id,
        openingId: wbOpening.id,
        amount: new Prisma.Decimal('250.00'),
        currency: 'SAR',
        provider: 'STRIPE',
        method: 'CARD',
        status: PaymentStatus.PENDING,
        providerRef: 'pi_real_ref_1',
        description: 'Mismatch test',
      },
    });
    trackPayment(pay3.id);
    const res4 = await paymentsSvc.webhookStripe(Buffer.from(successEvent(pay3.id, 'pi_attacker_ref', 25000, 'sar', 'evt_mismatch')), 'sig');
    assert(res4.ignored === 'providerRef_mismatch', `mismatch must be ignored, got ${JSON.stringify(res4)}`);
    const pay3After = await prisma.payment.findUniqueOrThrow({ where: { id: pay3.id } });
    assert(pay3After.status === PaymentStatus.PENDING, 'mismatched payment must stay PENDING');
    const evMismatch = await prisma.webhookEvent.count({ where: { id: 'evt_mismatch' } });
    assert(evMismatch === 0, 'mismatched event must NOT be recorded as processed (a retry re-verifies)');
    const refundTotal = (refundCalls as string[]).length;
    assert(refundTotal === 1, `mismatch must NOT trigger a refund (only the overflow one), got ${refundTotal}`);
    console.log('[webhook] providerRef mismatch refused without side effects');

    console.log('CAPACITY + WEBHOOK INTEGRATION TEST PASSED');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
    if (process.exitCode !== 1) {
      console.log('CLEANED UP all test rows.');
    }
  }
}

main();