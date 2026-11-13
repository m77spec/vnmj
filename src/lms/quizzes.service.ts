import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseOpeningStatus, EnrollmentStatus, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class QuizzesService {
  constructor(
    private prisma: PrismaService,
    private gamification: GamificationService,
    private audit?: AuditService,
  ) {}

  private stripAnswers(quiz: any) {
    if (!quiz) return quiz;
    const { questions, ...rest } = quiz;
    return {
      ...rest,
      questions: (questions ?? []).map((q: any) => {
        const { correctIndex, ...publicQuestion } = q;
        // `parseCorrectIndices` also reads the answer out of
        // `options[i].isCorrect`, so dropping only `correctIndex` left the key
        // sitting in the payload of a fully public GET /lms/quizzes/:id. Any
        // quiz authored in that shape was anonymously solvable.
        if (Array.isArray(publicQuestion.options)) {
          publicQuestion.options = publicQuestion.options.map((opt: any) => {
            if (opt && typeof opt === 'object' && 'isCorrect' in opt) {
              const { isCorrect, ...restOpt } = opt;
              return restOpt;
            }
            return opt;
          });
        }
        return publicQuestion;
      }),
    };
  }

  async create(data: any, actorId?: string) {
    const { questions = [], courseId, moduleId, openingId, ...quizData } = data;
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    this.validatePlacement(quizData.isFinal ?? false, moduleId);
    this.validateAttemptSettings(quizData.maxAttempts, quizData.gateNextLessons, quizData.isFinal ?? false);
    if (openingId && quizData.isFinal) {
      const existingFinal = await this.prisma.quiz.findFirst({ where: { openingId, isFinal: true } });
      if (existingFinal) throw new BadRequestException('This opening already has a final exam');
    }
    if (moduleId) {
      const mod = await this.prisma.module.findUnique({ where: { id: moduleId } });
      if (!mod || mod.courseId !== courseId || (mod.openingId && mod.openingId !== openingId)) {
        throw new BadRequestException('Module does not belong to this course opening');
      }
    }
    const created = await this.prisma.quiz.create({
      data: {
        ...quizData,
        courseId,
        openingId: openingId || null,
        moduleId: moduleId || null,
        questions: {
          create: questions.map((q: any, i: number) => ({ ...q, moduleId: undefined, courseId: undefined, orderIndex: q.orderIndex ?? i })),
        },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (created.openingId && actorId) {
      await this.audit?.logOpeningActivity?.(created.openingId, actorId, 'quiz_created', {
        entityType: 'quiz',
        entityId: created.id,
        titleAr: created.titleAr,
        questionCount: created.questions.length,
      });
    }
    return created;
  }

  async update(id: string, data: any, actorId?: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id } });
    if (!quiz) throw new NotFoundException('Quiz not found');
    const { questions, courseId, moduleId, openingId: _openingId, ...quizData } = data;
    const nextModuleId = moduleId !== undefined ? (moduleId || null) : quiz.moduleId;
    const isFinal = quizData.isFinal ?? quiz.isFinal ?? false;
    this.validatePlacement(isFinal, nextModuleId);
    this.validateAttemptSettings(quizData.maxAttempts ?? quiz.maxAttempts, quizData.gateNextLessons ?? quiz.gateNextLessons, isFinal);
    if (quiz.openingId && isFinal && !quiz.isFinal) {
      const existingFinal = await this.prisma.quiz.findFirst({ where: { openingId: quiz.openingId, isFinal: true, id: { not: id } } });
      if (existingFinal) throw new BadRequestException('This opening already has a final exam');
    }
    if (nextModuleId) {
      const mod = await this.prisma.module.findUnique({ where: { id: nextModuleId } });
      if (!mod || mod.courseId !== quiz.courseId || (mod.openingId && mod.openingId !== quiz.openingId)) {
        throw new BadRequestException('Module does not belong to this course opening');
      }
    }
    if (Array.isArray(questions)) {
      await this.prisma.$transaction([
        this.prisma.quizQuestion.deleteMany({ where: { quizId: id } }),
        this.prisma.quiz.update({
          where: { id },
          data: {
            ...quizData,
            moduleId: nextModuleId,
            questions: { create: questions.map((q: any, i: number) => ({ ...q, orderIndex: q.orderIndex ?? i })) },
          },
        }),
      ]);
    } else {
      await this.prisma.quiz.update({
        where: { id },
        data: { ...quizData, moduleId: nextModuleId },
      });
    }
    const updated = await this.prisma.quiz.findUnique({ where: { id }, include: { questions: { orderBy: { orderIndex: 'asc' } } } });
    if (quiz.openingId && actorId && updated) {
      await this.audit?.logOpeningActivity?.(quiz.openingId, actorId, 'quiz_updated', {
        entityType: 'quiz',
        entityId: quiz.id,
        titleAr: updated.titleAr,
        questionCount: updated.questions.length,
        changedFields: Object.keys(data).filter((key) => key !== 'questions'),
        questionsChanged: Array.isArray(questions),
      });
    }
    return updated;
  }

  async remove(id: string, actorId?: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id }, select: { id: true, openingId: true, titleAr: true, titleEn: true } });
    if (!quiz) throw new NotFoundException('Quiz not found');
    await this.prisma.quiz.delete({ where: { id } });
    if (quiz.openingId && actorId) {
      await this.audit?.logOpeningActivity?.(quiz.openingId, actorId, 'quiz_deleted', {
        entityType: 'quiz',
        entityId: quiz.id,
        quizTitleAr: quiz.titleAr,
        quizTitleEn: quiz.titleEn,
      });
    }
    return { ok: true };
  }

  private validatePlacement(isFinal: boolean, moduleId: string | null | undefined) {
    if (isFinal && moduleId) throw new BadRequestException('A final quiz cannot be assigned to a lesson');
    if (!isFinal && !moduleId) throw new BadRequestException('A lesson quiz must be assigned to a lesson');
  }

  private validateAttemptSettings(maxAttempts: number | null | undefined, gateNextLessons: boolean | undefined, isFinal: boolean) {
    if (maxAttempts !== undefined && maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100)) {
      throw new BadRequestException('maxAttempts must be between 1 and 100, or null for unlimited attempts');
    }
    if (gateNextLessons !== undefined && typeof gateNextLessons !== 'boolean') {
      throw new BadRequestException('gateNextLessons must be a boolean');
    }
    if (isFinal && gateNextLessons) {
      throw new BadRequestException('A final quiz cannot gate lesson access');
    }
  }

  private async assertCanManageOpening(openingId: string, actorId: string, role: Role) {
    const opening = await this.prisma.courseOpening.findUnique({
      where: { id: openingId },
      include: { instructorGrants: { where: { instructorId: actorId } } },
    });
    if (!opening || opening.archivedAt) throw new NotFoundException('Opening not found');
    if (opening.status !== CourseOpeningStatus.OPEN && opening.status !== CourseOpeningStatus.STARTED) {
      throw new ForbiddenException('Quizzes can only be managed for open or started courses');
    }
    if (role === Role.ADMIN || role === Role.COURSE_MANAGER) return opening;
    if (role !== Role.INSTRUCTOR) throw new ForbiddenException('You are not allowed to manage quizzes');
    const grant = opening.instructorGrants[0];
    if (opening.instructorId !== actorId && !grant?.canReadContent) {
      throw new ForbiddenException('You are not allowed to manage quizzes for this opening');
    }
    return opening;
  }

  async listForInstructor(openingId: string, actorId: string, role: Role) {
    await this.assertCanManageOpening(openingId, actorId, role);
    return this.listByOpening(openingId, true);
  }

  async createForInstructor(data: any, openingId: string, actorId: string, role: Role) {
    const opening = await this.assertCanManageOpening(openingId, actorId, role);
    if (data.courseId && data.courseId !== opening.courseId) throw new BadRequestException('Quiz course does not match the opening');
    const moduleId = data.moduleId || null;
    if (moduleId) {
      const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
      if (!module || module.courseId !== opening.courseId || (module.openingId && module.openingId !== openingId)) {
        throw new BadRequestException('Lesson does not belong to this opening');
      }
    }
    return this.create({ ...data, courseId: opening.courseId, openingId }, actorId);
  }

  async updateForInstructor(id: string, data: any, openingId: string, actorId: string, role: Role) {
    await this.assertCanManageOpening(openingId, actorId, role);
    const quiz = await this.prisma.quiz.findUnique({ where: { id }, select: { courseId: true, openingId: true } });
    if (!quiz) throw new NotFoundException('Quiz not found');
    if (quiz.openingId !== openingId) throw new NotFoundException('Quiz not found in this opening');
    if (data.courseId && data.courseId !== quiz.courseId) throw new BadRequestException('Quiz course cannot be changed');
    return this.update(id, data, actorId);
  }

  async removeForInstructor(id: string, openingId: string, actorId: string, role: Role) {
    await this.assertCanManageOpening(openingId, actorId, role);
    const quiz = await this.prisma.quiz.findUnique({ where: { id }, select: { openingId: true } });
    if (!quiz) throw new NotFoundException('Quiz not found');
    if (quiz.openingId !== openingId) throw new NotFoundException('Quiz not found in this opening');
    return this.remove(id, actorId);
  }

  private async getManagedQuiz(openingId: string, quizId: string, actorId: string, role: Role) {
    await this.assertCanManageOpening(openingId, actorId, role);
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId } });
    if (!quiz || quiz.openingId !== openingId) throw new NotFoundException('Quiz not found in this opening');
    return quiz;
  }

  async listAttemptsForOpening(openingId: string, quizId: string, actorId: string, role: Role) {
    const quiz = await this.getManagedQuiz(openingId, quizId, actorId, role);
    const [attempts, grants] = await Promise.all([
      this.prisma.quizAttempt.findMany({
        where: { quizId, enrollment: { openingId } },
        orderBy: [{ enrollmentId: 'asc' }, { submittedAt: 'desc' }],
        select: {
          id: true,
          score: true,
          passed: true,
          submittedAt: true,
          enrollmentId: true,
          enrollment: {
            select: {
              id: true,
              student: { select: { id: true, email: true, metadata: true } },
            },
          },
        },
      }),
      this.prisma.quizAttemptGrant.findMany({
        where: { quizId, enrollment: { openingId } },
        select: { enrollmentId: true, extraAttempts: true },
      }),
    ]);

    const grantCounts = new Map(grants.map((grant) => [grant.enrollmentId, grant.extraAttempts]));
    const students = new Map<string, {
      enrollmentId: string;
      student: { id: string; email: string; metadata: Prisma.JsonValue | null };
      attempts: typeof attempts;
      extraAttempts: number;
    }>();
    for (const attempt of attempts) {
      const enrollmentId = attempt.enrollmentId;
      const student = students.get(enrollmentId) ?? {
        enrollmentId,
        student: attempt.enrollment.student,
        attempts: [],
        extraAttempts: grantCounts.get(enrollmentId) ?? 0,
      };
      student.attempts.push(attempt);
      students.set(enrollmentId, student);
    }

    return [...students.values()].map((row) => ({
      ...row,
      attemptsAllowed: quiz.maxAttempts === null ? null : row.extraAttempts + quiz.maxAttempts,
    }));
  }

  async grantExtraAttempt(openingId: string, quizId: string, enrollmentId: string, actorId: string, role: Role) {
    const quiz = await this.getManagedQuiz(openingId, quizId, actorId, role);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, openingId, courseId: quiz.courseId, status: EnrollmentStatus.APPROVED },
      select: { id: true },
    });
    if (!enrollment) throw new NotFoundException('Approved student enrollment not found in this opening');
    const grant = await this.prisma.quizAttemptGrant.upsert({
      where: { quizId_enrollmentId: { quizId, enrollmentId } },
      create: { quizId, enrollmentId, extraAttempts: 1 },
      update: { extraAttempts: { increment: 1 } },
    });
    await this.audit?.logOpeningActivity?.(openingId, actorId, 'quiz_attempt_granted', {
      entityType: 'quiz',
      entityId: quizId,
      enrollmentId,
      extraAttempts: grant.extraAttempts,
    });
    return grant;
  }

  async resetStudentAttempts(openingId: string, quizId: string, enrollmentId: string, actorId: string, role: Role) {
    const quiz = await this.getManagedQuiz(openingId, quizId, actorId, role);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, openingId, courseId: quiz.courseId, status: EnrollmentStatus.APPROVED },
      select: { id: true },
    });
    if (!enrollment) throw new NotFoundException('Approved student enrollment not found in this opening');
    const [attempts] = await this.prisma.$transaction([
      this.prisma.quizAttempt.deleteMany({ where: { quizId, enrollmentId } }),
      this.prisma.quizAttemptGrant.deleteMany({ where: { quizId, enrollmentId } }),
    ]);
    await this.audit?.logOpeningActivity?.(openingId, actorId, 'quiz_attempts_reset', {
      entityType: 'quiz',
      entityId: quizId,
      enrollmentId,
      attemptsDeleted: attempts.count,
    });
    return { deletedAttempts: attempts.count };
  }

  async listByOpening(openingId: string, includeUnpublished: boolean) {
    const quizzes = await this.prisma.quiz.findMany({
      where: { openingId, ...(includeUnpublished ? {} : { isPublished: true }) },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    });
    return includeUnpublished ? quizzes : quizzes.map((quiz) => this.stripAnswers(quiz));
  }

  async listForEnrolledOpening(courseId: string, openingId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, openingId, studentId, status: EnrollmentStatus.APPROVED },
      select: { id: true, openingId: true },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this opening');
    const quizzes = await this.prisma.quiz.findMany({
      where: { courseId, isPublished: true, OR: [{ openingId: null }, { openingId }] },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    });
    const accessibleQuizzes = await Promise.all(quizzes.map(async (quiz) =>
      await this.isLessonLockedForStudent(quiz, enrollment.id, enrollment.openingId) ? null : quiz,
    ));
    return accessibleQuizzes.filter((quiz) => quiz !== null).map((quiz) => this.stripAnswers(quiz));
  }

  async listByCourse(courseId: string, includeUnpublished: boolean, studentId?: string) {
    const quizzes = await this.prisma.quiz.findMany({
      where: { courseId, openingId: null, ...(includeUnpublished ? {} : { isPublished: true }) },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    });
    if (includeUnpublished) return quizzes;
    if (!studentId) return quizzes.map((quiz) => this.stripAnswers(quiz));
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId, status: EnrollmentStatus.APPROVED },
      select: { id: true, openingId: true },
    });
    const accessibleQuizzes = enrollment
      ? await Promise.all(quizzes.map(async (quiz) =>
        await this.isLessonLockedForStudent(quiz, enrollment.id, enrollment.openingId) ? null : quiz,
      ))
      : quizzes;
    return accessibleQuizzes.filter((quiz) => quiz !== null).map((quiz) => this.stripAnswers(quiz));
  }

  async getPublic(id: string, studentId?: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!quiz || !quiz.isPublished) throw new NotFoundException('Quiz not found');
    if (quiz.openingId && !studentId) throw new NotFoundException('Quiz not found');
    if (studentId) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          courseId: quiz.courseId,
          studentId,
          status: EnrollmentStatus.APPROVED,
          ...(quiz.openingId ? { openingId: quiz.openingId } : {}),
        },
        select: { id: true, openingId: true },
      });
      if (!enrollment && quiz.openingId) throw new NotFoundException('Quiz not found');
      if (enrollment && await this.isLessonLockedForStudent(quiz, enrollment.id, enrollment.openingId)) {
        throw new ForbiddenException('Pass the required quiz before opening this lesson');
      }
    }
    return this.stripAnswers(quiz);
  }

  async myAttempt(quizId: string, studentId: string) {
    const quiz = await this.prisma.quiz.findUnique({ where: { id: quizId }, select: { maxAttempts: true } });
    if (!quiz) throw new NotFoundException('Quiz not found');
    const [attempt, attemptsUsed, grant] = await Promise.all([
      this.prisma.quizAttempt.findFirst({
        where: { quizId, enrollment: { studentId } },
        orderBy: [{ score: 'desc' }, { submittedAt: 'desc' }],
      }),
      this.prisma.quizAttempt.count({ where: { quizId, enrollment: { studentId } } }),
      this.prisma.quizAttemptGrant.findFirst({
        where: { quizId, enrollment: { studentId } },
        select: { extraAttempts: true },
      }),
    ]);
    const attemptsAllowed = quiz.maxAttempts === null ? null : quiz.maxAttempts + (grant?.extraAttempts ?? 0);
    return attempt ? {
      ...attempt,
      attemptsUsed,
      attemptsAllowed,
      canAttempt: attemptsAllowed === null || attemptsUsed < attemptsAllowed,
    } : {
      attemptsUsed,
      attemptsAllowed,
      canAttempt: true,
    };
  }

  private async isLessonLockedForStudent(
    quiz: { courseId: string; moduleId: string | null },
    enrollmentId: string,
    openingId: string | null,
  ) {
    if (!quiz.moduleId) return false;
    const modules = await this.prisma.module.findMany({
      where: {
        courseId: quiz.courseId,
        OR: openingId ? [{ openingId: null }, { openingId }] : [{ openingId: null }],
      },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const moduleIndexes = new Map(modules.map((module, index) => [module.id, index]));
    const targetIndex = moduleIndexes.get(quiz.moduleId);
    if (targetIndex === undefined) return false;
    const gates = await this.prisma.quiz.findMany({
      where: {
        courseId: quiz.courseId,
        gateNextLessons: true,
        moduleId: { not: null },
        OR: openingId ? [{ openingId: null }, { openingId }] : [{ openingId: null }],
      },
      select: {
        moduleId: true,
        attempts: { where: { enrollmentId }, select: { passed: true } },
      },
    });
    return gates.some((gate) =>
      gate.moduleId !== null
      && (moduleIndexes.get(gate.moduleId) ?? Number.MAX_SAFE_INTEGER) < targetIndex
      && !gate.attempts.some((attempt) => attempt.passed),
    );
  }

  private parseCorrectIndices(question: any): number[] {
    const indices = new Set<number>();
    if (question.correctIndex !== null && question.correctIndex !== undefined) indices.add(Number(question.correctIndex));
    const options = Array.isArray(question.options) ? question.options : [];
    options.forEach((opt: any, i: number) => {
      if (opt && typeof opt === 'object' && opt.isCorrect) indices.add(i);
    });
    return [...indices].sort();
  }

  private scoreQuiz(quiz: any, answers: any[]) {
    let correct = 0;
    const total = quiz.questions.length;
    const details = quiz.questions.map((question: any) => {
      const answer = answers.find((a: any) => a.questionId === question.id);
      const selected: number[] = Array.isArray(answer?.selected) ? answer.selected.map(Number) : [];
      const correctSet = this.parseCorrectIndices(question);
      const isCorrect = correctSet.length > 0 && JSON.stringify([...selected].sort()) === JSON.stringify(correctSet);
      if (isCorrect) correct += 1;
      // `isCorrect` is feedback a student is entitled to. `correctAnswer` is
      // the key: returning it let anyone submit dummy answers, read the
      // correct indices out of the response and resubmit for 100%, which
      // defeats passScore (gating module completion) and the quiz_perfect /
      // quiz_master awards. Grading still uses correctSet internally; only the
      // per-question breakdown is withheld.
      return { questionId: question.id, isCorrect };
    });
    const score = total === 0 ? 0 : Math.round((correct / total) * 100);
    return { score, passed: score >= quiz.passScore, details };
  }

  async attempt(quizId: string, enrollmentId: string, answers: any[], studentId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!quiz || !quiz.isPublished) throw new NotFoundException('Quiz not found');

    const enrollment = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.studentId !== studentId) throw new ForbiddenException('Not your enrollment');
    if (enrollment.courseId !== quiz.courseId) throw new BadRequestException('Quiz does not belong to this course');
    if (quiz.openingId && enrollment.openingId !== quiz.openingId) throw new ForbiddenException('Quiz does not belong to this opening');
    if (await this.isLessonLockedForStudent(quiz, enrollment.id, enrollment.openingId)) {
      throw new ForbiddenException('Pass the required quiz before opening this lesson');
    }

    const result = this.scoreQuiz(quiz, answers);
    const { attempt, attemptsUsed, attemptsAllowed, shouldAwardPoints } = await this.prisma.$transaction(async (tx) => {
      const attemptsUsed = await tx.quizAttempt.count({ where: { quizId, enrollmentId } });
      const [previousPasses, previousPerfects] = await Promise.all([
        tx.quizAttempt.count({ where: { quizId, enrollmentId, passed: true } }),
        tx.quizAttempt.count({ where: { quizId, enrollmentId, score: 100 } }),
      ]);
      const grant = await tx.quizAttemptGrant.findUnique({
        where: { quizId_enrollmentId: { quizId, enrollmentId } },
        select: { extraAttempts: true },
      });
      const attemptsAllowed = quiz.maxAttempts === null ? null : quiz.maxAttempts + (grant?.extraAttempts ?? 0);
      if (attemptsAllowed !== null && attemptsUsed >= attemptsAllowed) {
        throw new ConflictException({
          message: 'No quiz attempts remain',
          code: 'QUIZ_ATTEMPTS_EXHAUSTED',
          attemptsUsed,
          attemptsAllowed,
        });
      }
      const attempt = await tx.quizAttempt.create({
        data: { quizId, enrollmentId, score: result.score, passed: result.passed, answers: answers as object },
      });
      const shouldAwardPoints = result.passed && (result.score === 100 ? previousPerfects === 0 : previousPasses === 0);
      return { attempt, attemptsUsed: attemptsUsed + 1, attemptsAllowed, shouldAwardPoints };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (quiz.openingId) {
      await this.audit?.logOpeningActivity?.(quiz.openingId, studentId, 'quiz_attempt', {
        entityType: 'quiz_attempt',
        entityId: attempt.id,
        quizId: quiz.id,
        quizTitleAr: quiz.titleAr,
        quizTitleEn: quiz.titleEn,
        score: result.score,
        passed: result.passed,
      });
    }

    if (shouldAwardPoints) {
      try {
        await this.gamification.addPoints(studentId, result.score === 100 ? 'quiz_perfect' : 'quiz_pass');
      } catch {}
    }

    return { attempt, attemptsUsed, attemptsAllowed, score: result.score, passed: result.passed, details: result.details };
  }
}