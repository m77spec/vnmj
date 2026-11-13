import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseEvaluationMetric, CourseEvaluationQuestionType, EnrollmentStatus, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { GamificationService } from '../gamification/gamification.service';
import { PrismaService } from '../prisma/prisma.service';

type EvaluationAnswerInput = { questionId: string; value: unknown };
type EvaluationQuestionInput = {
  id?: string;
  promptAr: string;
  promptEn: string;
  type: CourseEvaluationQuestionType;
  metric?: CourseEvaluationMetric;
  isRequired: boolean;
  options?: { value: string; labelAr: string; labelEn: string }[];
};
type EvaluationFormInput = {
  titleAr: string;
  titleEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  questions: EvaluationQuestionInput[];
};

const QUESTION_TYPES = Object.values(CourseEvaluationQuestionType);
const QUESTION_METRICS = Object.values(CourseEvaluationMetric);

@Injectable()
export class CourseEvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gamification: GamificationService,
  ) {}

  private getOrCreateCourseForm(courseId: string) {
    return this.prisma.courseEvaluationForm.upsert({
      where: { courseId },
      update: {},
      create: {
        courseId,
        titleAr: 'تقييم الدورة والمدرّب',
        titleEn: 'Course and instructor evaluation',
        descriptionAr: 'يساعدنا رأيك على تحسين محتوى الدورة وتجربة التعلّم.',
        descriptionEn: 'Your feedback helps us improve the course content and learning experience.',
        questions: {
          create: [
            {
              promptAr: 'كيف تقيّم محتوى الدورة؟',
              promptEn: 'How would you rate the course content?',
              type: CourseEvaluationQuestionType.RATING,
              metric: CourseEvaluationMetric.COURSE,
              isRequired: true,
              orderIndex: 0,
            },
            {
              promptAr: 'كيف تقيّم أداء المدرّب؟',
              promptEn: 'How would you rate the instructor?',
              type: CourseEvaluationQuestionType.RATING,
              metric: CourseEvaluationMetric.INSTRUCTOR,
              isRequired: true,
              orderIndex: 1,
            },
            {
              promptAr: 'ما اقتراحك لتحسين الدورة؟',
              promptEn: 'What would you suggest to improve this course?',
              type: CourseEvaluationQuestionType.TEXT,
              metric: CourseEvaluationMetric.GENERAL,
              isRequired: false,
              orderIndex: 2,
            },
          ],
        },
      },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  private async getEligibleEnrollment(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      include: {
        course: { select: { id: true, titleAr: true, titleEn: true, instructorId: true } },
        opening: { select: { id: true, instructorId: true, nameAr: true, nameEn: true } },
        courseEvaluation: { select: { id: true, createdAt: true } },
      },
    });
    if (!enrollment || enrollment.status !== EnrollmentStatus.APPROVED) {
      throw new ForbiddenException('Only approved students can evaluate a course');
    }
    return enrollment;
  }

  private async completionState(enrollmentId: string, courseId: string, openingId: string | null) {
    const modules = await this.prisma.module.findMany({
      where: {
        courseId,
        OR: openingId ? [{ openingId: null }, { openingId }] : [{ openingId: null }],
      },
      select: { id: true },
    });
    const moduleIds = modules.map((module) => module.id);
    const [progress, tasks, quizzes] = modules.length
      ? await Promise.all([
          this.prisma.lessonProgress.findMany({
          where: { enrollmentId, moduleId: { in: modules.map((module) => module.id) } },
          select: { moduleId: true },
          }),
          openingId ? this.prisma.courseTask.findMany({
            where: { openingId, moduleId: { in: moduleIds } },
            select: { submissions: { where: { enrollmentId }, select: { id: true } } },
          }) : Promise.resolve([]),
          this.prisma.quiz.findMany({
            where: {
              courseId,
              moduleId: { in: moduleIds },
              isPublished: true,
              OR: openingId ? [{ openingId: null }, { openingId }] : [{ openingId: null }],
            },
            select: { attempts: { where: { enrollmentId }, select: { passed: true } } },
          }),
        ])
      : [[], [], []];
    const completed = new Set(progress.map((row) => row.moduleId));
    const pendingTasks = tasks.filter((task) => task.submissions.length === 0).length;
    const failedQuizzes = quizzes.filter((quiz) => !quiz.attempts.some((attempt) => attempt.passed)).length;
    return {
      totalLessons: modules.length,
      completedLessons: completed.size,
      pendingTasks,
      failedQuizzes,
      canSubmit: modules.length > 0 && completed.size === modules.length && pendingTasks === 0 && failedQuizzes === 0,
    };
  }

  async getMine(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: {
        id: true,
        status: true,
        openingId: true,
        courseEvaluation: { select: { id: true, createdAt: true } },
      },
    });
    if (!enrollment) throw new ForbiddenException('You are not enrolled in this course');
    if (enrollment.status !== EnrollmentStatus.APPROVED) {
      return {
        courseId,
        openingId: enrollment.openingId,
        submitted: false,
        submittedAt: null,
        totalLessons: 0,
        completedLessons: 0,
        pendingTasks: 0,
        failedQuizzes: 0,
        canSubmit: false,
      };
    }
    const [state, evaluation, form] = await Promise.all([
      this.completionState(enrollment.id, courseId, enrollment.openingId),
      Promise.resolve(enrollment.courseEvaluation),
      this.getOrCreateCourseForm(courseId),
    ]);
    return {
      courseId,
      openingId: enrollment.openingId,
      submitted: Boolean(evaluation),
      submittedAt: evaluation?.createdAt ?? null,
      form: form ? {
        id: form.id,
        titleAr: form.titleAr,
        titleEn: form.titleEn,
        descriptionAr: form.descriptionAr,
        descriptionEn: form.descriptionEn,
        questions: form.questions,
      } : null,
      ...state,
    };
  }

  async submit(courseId: string, studentId: string, input: { answers: EvaluationAnswerInput[] }) {
    const enrollment = await this.getEligibleEnrollment(courseId, studentId);
    if (enrollment.courseEvaluation) {
      throw new ConflictException('Course evaluation has already been submitted');
    }
    const state = await this.completionState(enrollment.id, courseId, enrollment.openingId);
    if (!state.canSubmit) {
      throw new ConflictException({
        message: 'Complete all course lessons before submitting the evaluation',
        code: 'COURSE_LESSONS_INCOMPLETE',
        ...state,
      });
    }

    const form = await this.getOrCreateCourseForm(courseId);
    if (!form || form.questions.length === 0) {
      throw new ConflictException('This course evaluation form is not configured');
    }
    if (!Array.isArray(input?.answers)) throw new BadRequestException('answers must be an array');
    const answerMap = new Map<string, unknown>();
    for (const answer of input.answers) {
      if (!answer || typeof answer.questionId !== 'string' || answerMap.has(answer.questionId)) {
        throw new BadRequestException('Invalid or duplicate evaluation answer');
      }
      answerMap.set(answer.questionId, answer.value);
    }
    const questionIds = new Set(form.questions.map(({ id }) => id));
    if ([...answerMap.keys()].some((id) => !questionIds.has(id))) {
      throw new BadRequestException('An evaluation answer does not belong to this form');
    }

    const answers: Prisma.InputJsonValue[] = [];
    let courseRating: number | null = null;
    let instructorRating: number | null = null;
    let comment: string | null = null;
    for (const question of form.questions) {
      const value = answerMap.get(question.id);
      const isEmpty = value === undefined || value === null || value === ''
        || (question.type === CourseEvaluationQuestionType.TEXT && typeof value === 'string' && !value.trim())
        || (Array.isArray(value) && value.length === 0);
      if (question.isRequired && isEmpty) {
        throw new BadRequestException(`Answer is required for: ${question.promptEn}`);
      }
      if (isEmpty) continue;

      const options = Array.isArray(question.options) ? question.options as Array<{ value?: unknown }> : [];
      let normalizedValue: string | number | boolean | string[];
      switch (question.type) {
        case CourseEvaluationQuestionType.RATING:
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
            throw new BadRequestException('Rating answers must be an integer between 1 and 5');
          }
          normalizedValue = value;
          if (question.metric === CourseEvaluationMetric.COURSE && courseRating === null) courseRating = value;
          if (question.metric === CourseEvaluationMetric.INSTRUCTOR && instructorRating === null) instructorRating = value;
          break;
        case CourseEvaluationQuestionType.SINGLE_CHOICE:
          if (typeof value !== 'string' || !options.some((option) => option.value === value)) {
            throw new BadRequestException('Select one of the available answers');
          }
          normalizedValue = value;
          break;
        case CourseEvaluationQuestionType.MULTIPLE_CHOICE:
          if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')
            || new Set(value).size !== value.length
            || value.some((entry) => !options.some((option) => option.value === entry))) {
            throw new BadRequestException('Select valid available answers');
          }
          normalizedValue = value as string[];
          break;
        case CourseEvaluationQuestionType.TEXT:
          if (typeof value !== 'string' || value.length > 2000) {
            throw new BadRequestException('Text answers must be at most 2000 characters');
          }
          normalizedValue = value.trim();
          if (comment === null && normalizedValue) comment = normalizedValue;
          break;
        case CourseEvaluationQuestionType.YES_NO:
          if (typeof value !== 'boolean') throw new BadRequestException('Yes/no answers must be true or false');
          normalizedValue = value;
          break;
        default:
          throw new BadRequestException('Unsupported evaluation question type');
      }
      answers.push({
        questionId: question.id,
        promptAr: question.promptAr,
        promptEn: question.promptEn,
        type: question.type,
        metric: question.metric,
        options: question.options ?? [],
        value: normalizedValue,
      });
    }

    let evaluation;
    try {
      evaluation = await this.prisma.courseEvaluation.create({
        data: {
          courseRating,
          instructorRating,
          commentAr: comment,
          commentEn: comment,
          answers,
          enrollmentId: enrollment.id,
          courseId,
          openingId: enrollment.openingId,
          instructorId: enrollment.opening?.instructorId ?? enrollment.course.instructorId,
          formId: form.id,
        },
        select: { id: true, createdAt: true },
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Course evaluation has already been submitted');
      }
      throw error;
    }

    await this.audit.logAction(
      `Submitted course and instructor evaluation for enrollment ${enrollment.id}`,
      undefined,
      studentId,
    );
    try {
      await this.gamification.addPoints(studentId, 'course_complete');
    } catch {
      // Evaluation persistence is authoritative; reward failures must not discard a valid submission.
    }
    return { submitted: true, submittedAt: evaluation.createdAt };
  }

  async listCourseForms() {
    const courses = await this.prisma.course.findMany({
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        archivedAt: true,
        evaluationForm: {
          include: {
            questions: { orderBy: { orderIndex: 'asc' } },
            _count: { select: { evaluations: true } },
          },
        },
      },
      orderBy: [{ archivedAt: 'asc' }, { titleEn: 'asc' }],
    });
    return courses;
  }

  async saveCourseForm(courseId: string, input: EvaluationFormInput, actorId: string) {
    if (!input || typeof input.titleAr !== 'string' || !input.titleAr.trim()
      || typeof input.titleEn !== 'string' || !input.titleEn.trim()
      || input.titleAr.length > 160 || input.titleEn.length > 160
      || (input.descriptionAr !== undefined && input.descriptionAr !== null
        && (typeof input.descriptionAr !== 'string' || input.descriptionAr.length > 1000))
      || (input.descriptionEn !== undefined && input.descriptionEn !== null
        && (typeof input.descriptionEn !== 'string' || input.descriptionEn.length > 1000))
      || !Array.isArray(input.questions) || input.questions.length === 0 || input.questions.length > 40) {
      throw new BadRequestException('Form titles and 1 to 40 questions are required');
    }
    for (const [index, question] of input.questions.entries()) {
      if (!question || typeof question.promptAr !== 'string' || !question.promptAr.trim()
        || typeof question.promptEn !== 'string' || !question.promptEn.trim()
        || question.promptAr.length > 500 || question.promptEn.length > 500
        || !QUESTION_TYPES.includes(question.type)
        || (question.metric !== undefined && !QUESTION_METRICS.includes(question.metric))
        || typeof question.isRequired !== 'boolean') {
        throw new BadRequestException(`Question ${index + 1} is invalid`);
      }
      if (question.type === CourseEvaluationQuestionType.RATING
        && (question.metric === CourseEvaluationMetric.COURSE || question.metric === CourseEvaluationMetric.INSTRUCTOR)) {
        const duplicateMetric = input.questions.slice(0, index).some((item) =>
          item.type === CourseEvaluationQuestionType.RATING && item.metric === question.metric);
        if (duplicateMetric) throw new BadRequestException(`Only one ${question.metric.toLowerCase()} rating question is allowed`);
      } else if (question.metric === CourseEvaluationMetric.COURSE || question.metric === CourseEvaluationMetric.INSTRUCTOR) {
        throw new BadRequestException('Course and instructor metrics are only available for rating questions');
      }
      if (question.type === CourseEvaluationQuestionType.SINGLE_CHOICE
        || question.type === CourseEvaluationQuestionType.MULTIPLE_CHOICE) {
        if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 20
          || question.options.some((option) =>
            !option || typeof option.value !== 'string' || !option.value.trim() || option.value.length > 100
            || typeof option.labelAr !== 'string' || !option.labelAr.trim() || option.labelAr.length > 120
            || typeof option.labelEn !== 'string' || !option.labelEn.trim() || option.labelEn.length > 120)
          || new Set(question.options.map((option) => option.value)).size !== question.options.length) {
          throw new BadRequestException(`Question ${index + 1} needs 2 to 20 unique bilingual options`);
        }
      } else if (question.options?.length) {
        throw new BadRequestException(`Question ${index + 1} cannot have answer options`);
      }
    }

    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new NotFoundException('Course not found');
    const form = await this.prisma.$transaction(async (tx) => {
      const savedForm = await tx.courseEvaluationForm.upsert({
        where: { courseId },
        update: {
          titleAr: input.titleAr.trim(),
          titleEn: input.titleEn.trim(),
          descriptionAr: input.descriptionAr?.trim() || null,
          descriptionEn: input.descriptionEn?.trim() || null,
        },
        create: {
          courseId,
          titleAr: input.titleAr.trim(),
          titleEn: input.titleEn.trim(),
          descriptionAr: input.descriptionAr?.trim() || null,
          descriptionEn: input.descriptionEn?.trim() || null,
        },
      });
      await tx.courseEvaluationQuestion.deleteMany({ where: { formId: savedForm.id } });
      for (const [orderIndex, question] of input.questions.entries()) {
        await tx.courseEvaluationQuestion.create({
          data: {
            formId: savedForm.id,
            promptAr: question.promptAr.trim(),
            promptEn: question.promptEn.trim(),
            type: question.type,
            metric: question.type === CourseEvaluationQuestionType.RATING
              ? question.metric ?? CourseEvaluationMetric.GENERAL
              : CourseEvaluationMetric.GENERAL,
            isRequired: question.isRequired,
            orderIndex,
            options: question.options?.length
              ? question.options as Prisma.InputJsonValue
              : Prisma.DbNull,
          },
        });
      }
      return savedForm;
    });
    await this.audit.logAction(`Updated evaluation form ${form.id} for Course ${courseId}`, undefined, actorId);
    return this.prisma.courseEvaluationForm.findUnique({
      where: { id: form.id },
      include: { questions: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async listOpeningSummaries() {
    const groups = await this.prisma.courseEvaluation.groupBy({
      by: ['openingId', 'courseId'],
      _avg: { courseRating: true, instructorRating: true },
      _count: { _all: true },
    });
    const openingIds = groups.map((group) => group.openingId).filter((id): id is string => Boolean(id));
    const legacyCourseIds = groups.filter((group) => !group.openingId).map((group) => group.courseId);
    const [openings, legacyCourses] = await Promise.all([
      openingIds.length ? this.prisma.courseOpening.findMany({
        where: { id: { in: openingIds } },
        select: {
          id: true,
          nameAr: true,
          nameEn: true,
          status: true,
          endDate: true,
          course: { select: { id: true, titleAr: true, titleEn: true } },
          instructor: { select: { id: true, email: true } },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.APPROVED } } } },
        },
        orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
      }) : [],
      legacyCourseIds.length ? this.prisma.course.findMany({
        where: { id: { in: [...new Set(legacyCourseIds)] } },
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          instructorId: true,
          instructor: { select: { email: true } },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.APPROVED, openingId: null } } } },
        },
      }) : [],
    ]);
    const openingById = new Map(openings.map((opening) => [opening.id, opening]));
    const courseById = new Map(legacyCourses.map((course) => [course.id, course]));
    const summaries: Array<{
      id: string;
      nameAr: string | null;
      nameEn: string | null;
      status: string | null;
      endDate: Date | null;
      course: { id: string; titleAr: string; titleEn: string };
      instructor: { id: string; email: string };
      responseCount: number;
      approvedStudentCount: number;
      averageCourseRating: number;
      averageInstructorRating: number;
    }> = [];
    for (const group of groups) {
      const averages = {
        responseCount: group._count._all,
        averageCourseRating: group._avg.courseRating ?? 0,
        averageInstructorRating: group._avg.instructorRating ?? 0,
      };
      if (group.openingId) {
        const opening = openingById.get(group.openingId);
        if (!opening) continue;
        summaries.push({
          ...opening,
          ...averages,
          approvedStudentCount: opening._count.enrollments,
        });
        continue;
      }

      const course = courseById.get(group.courseId);
      if (!course) continue;
      summaries.push({
        id: `course:${group.courseId}`,
        nameAr: null,
        nameEn: null,
        status: null,
        endDate: null,
        course: { id: course.id, titleAr: course.titleAr, titleEn: course.titleEn },
        instructor: { id: course.instructorId, email: course.instructor.email },
        ...averages,
        approvedStudentCount: course._count.enrollments,
      });
    }
    return summaries;
  }

  async listOpeningEvaluations(openingId: string) {
    const legacyCourseId = openingId.startsWith('course:') ? openingId.slice('course:'.length) : null;
    if (legacyCourseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: legacyCourseId },
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          instructorId: true,
          instructor: { select: { id: true, email: true } },
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.APPROVED, openingId: null } } } },
        },
      });
      if (!course) throw new NotFoundException('Course not found');
      const evaluations = await this.prisma.courseEvaluation.findMany({
        where: { courseId: legacyCourseId, openingId: null },
        select: {
          id: true,
          courseRating: true,
          instructorRating: true,
          commentAr: true,
          commentEn: true,
          answers: true,
          createdAt: true,
          enrollment: { select: { student: { select: { id: true, email: true, metadata: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        opening: {
          id: openingId,
          nameAr: null,
          nameEn: null,
          status: null,
          course: { id: course.id, titleAr: course.titleAr, titleEn: course.titleEn },
          instructor: course.instructor,
        },
        responseCount: evaluations.length,
        approvedStudentCount: course._count.enrollments,
        averageCourseRating: evaluations.filter((evaluation) => evaluation.courseRating !== null).length
        ? evaluations.reduce((sum, evaluation) => sum + (evaluation.courseRating ?? 0), 0)
          / evaluations.filter((evaluation) => evaluation.courseRating !== null).length
        : 0,
        averageInstructorRating: evaluations.filter((evaluation) => evaluation.instructorRating !== null).length
        ? evaluations.reduce((sum, evaluation) => sum + (evaluation.instructorRating ?? 0), 0)
          / evaluations.filter((evaluation) => evaluation.instructorRating !== null).length
        : 0,
        evaluations,
      };
    }

    const opening = await this.prisma.courseOpening.findUnique({
      where: { id: openingId },
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        status: true,
        course: { select: { id: true, titleAr: true, titleEn: true } },
        instructor: { select: { id: true, email: true } },
        _count: { select: { enrollments: { where: { status: EnrollmentStatus.APPROVED } } } },
      },
    });
    if (!opening) throw new NotFoundException('Course opening not found');

    const evaluations = await this.prisma.courseEvaluation.findMany({
      where: { openingId },
      select: {
        id: true,
        courseRating: true,
        instructorRating: true,
        commentAr: true,
        commentEn: true,
        answers: true,
        createdAt: true,
        enrollment: {
          select: {
            student: { select: { id: true, email: true, metadata: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      opening,
      responseCount: evaluations.length,
      approvedStudentCount: opening._count.enrollments,
      averageCourseRating: evaluations.filter((evaluation) => evaluation.courseRating !== null).length
        ? evaluations.reduce((sum, evaluation) => sum + (evaluation.courseRating ?? 0), 0)
          / evaluations.filter((evaluation) => evaluation.courseRating !== null).length
        : 0,
      averageInstructorRating: evaluations.filter((evaluation) => evaluation.instructorRating !== null).length
        ? evaluations.reduce((sum, evaluation) => sum + (evaluation.instructorRating ?? 0), 0)
          / evaluations.filter((evaluation) => evaluation.instructorRating !== null).length
        : 0,
      evaluations,
    };
  }

  assertStaffCanRead(role: Role) {
    if (role !== Role.ADMIN && role !== Role.COURSE_MANAGER) {
      throw new ForbiddenException('Only administrators and course managers can view course evaluations');
    }
  }
}
