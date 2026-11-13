import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class GamificationService {
    constructor(private prisma: PrismaService) {}

    private readonly BADGES: Record<string, { nameAr: string; nameEn: string; icon: string; threshold: number }> = {
        first_lesson: { nameAr: 'أول درس', nameEn: 'First Lesson', icon: 'BookOpen', threshold: 1 },
        quiz_master: { nameAr: 'سيد الاختبارات', nameEn: 'Quiz Master', icon: 'Brain', threshold: 5 },
        streak_7: { nameAr: 'سلسلة 7 أيام', nameEn: '7-Day Streak', icon: 'Flame', threshold: 7 },
        streak_30: { nameAr: 'سلسلة 30 يوم', nameEn: '30-Day Streak', icon: 'Flame', threshold: 30 },
        course_complete: { nameAr: 'إتمام دورة', nameEn: 'Course Complete', icon: 'Trophy', threshold: 1 },
        discussion_star: { nameAr: 'نجم النقاشات', nameEn: 'Discussion Star', icon: 'MessageCircle', threshold: 10 },
        helpful_peer: { nameAr: 'زميل مفيد', nameEn: 'Helpful Peer', icon: 'Heart', threshold: 5 },
    };

    private readonly POINT_ACTIONS: Record<string, number> = {
        lesson_complete: 10,
        quiz_pass: 20,
        quiz_perfect: 50,
        course_complete: 100,
        discussion_post: 5,
        discussion_reply: 3,
        peer_review: 15,
        daily_login: 5,
        streak_bonus: 10,
    };

    private readonly LEVEL_XP = 100;

    async getOrCreatePoints(userId: string) {
        let points = await this.prisma.userPoints.findUnique({ where: { userId } });
        if (!points) {
            points = await this.prisma.userPoints.create({ data: { userId, points: 0, level: 1, streak: 0 } });
        }
        return points;
    }

    async addPoints(userId: string, action: string) {
        const earned = this.POINT_ACTIONS[action] ?? 5;
        const points = await this.getOrCreatePoints(userId);
        const newTotal = points.points + earned;
        const newLevel = Math.floor(newTotal / this.LEVEL_XP) + 1;
        const updated = await this.prisma.userPoints.update({
            where: { userId },
            data: { points: newTotal, level: newLevel },
        });
        await this.prisma.pointLog.create({ data: { userId, action, points: earned } });
        await this.checkAndAwardBadges(userId);
        return updated;
    }

    async trackActivity(userId: string) {
        const points = await this.getOrCreatePoints(userId);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastActive = points.lastActiveDate ? new Date(points.lastActiveDate) : null;
        lastActive?.setHours(0, 0, 0, 0);

        let newStreak = points.streak;
        if (!lastActive || lastActive.getTime() < today.getTime() - 86400000) {
            newStreak = 1;
        } else if (lastActive.getTime() < today.getTime()) {
            newStreak = points.streak + 1;
        }

        await this.prisma.userPoints.update({
            where: { userId },
            data: { lastActiveDate: new Date(), streak: newStreak },
        });

        if (newStreak >= 7) await this.awardBadge(userId, 'streak_7');
        if (newStreak >= 30) await this.awardBadge(userId, 'streak_30');
        if (newStreak >= 2) await this.addPoints(userId, 'streak_bonus');

        return { streak: newStreak };
    }

    async awardBadge(userId: string, badgeType: string) {
        const points = await this.getOrCreatePoints(userId);
        await this.prisma.userBadge.upsert({
            where: { pointsId_badgeType: { pointsId: points.id, badgeType } },
            update: {},
            create: { pointsId: points.id, badgeType },
        });
    }

    async checkAndAwardBadges(userId: string) {
        const lessonCount = await this.prisma.lessonProgress.count({ where: { enrollment: { studentId: userId } } });
        if (lessonCount >= 1) await this.awardBadge(userId, 'first_lesson');

        const passedQuizzes = await this.prisma.quizAttempt.findMany({
            where: { enrollment: { studentId: userId }, passed: true },
            distinct: ['quizId'],
            select: { quizId: true },
        });
        if (passedQuizzes.length >= 5) await this.awardBadge(userId, 'quiz_master');

        const completedCourses = await this.prisma.enrollment.count({ where: { studentId: userId, status: 'APPROVED' } });
        if (completedCourses >= 1) await this.awardBadge(userId, 'course_complete');

        const posts = await this.prisma.discussionPost.count({ where: { authorId: userId } });
        if (posts >= 10) await this.awardBadge(userId, 'discussion_star');

        const reviews = await this.prisma.peerReview.count({ where: { reviewerId: userId } });
        if (reviews >= 5) await this.awardBadge(userId, 'helpful_peer');
    }

    async getUserGamificationForViewer(userId: string, requesterId: string, requesterRole: Role) {
        if (requesterId !== userId && requesterRole !== Role.ADMIN) {
            throw new ForbiddenException('Access denied');
        }
        return this.getUserGamification(userId);
    }

    async getUserGamification(userId: string) {
        const points = await this.getOrCreatePoints(userId);
        const badges = await this.prisma.userBadge.findMany({ where: { pointsId: points.id } });
        const allBadges = Object.entries(this.BADGES).map(([type, info]) => ({
            type,
            ...info,
            earned: badges.some(b => b.badgeType === type),
        }));
        const xpInLevel = points.points % this.LEVEL_XP;
        return { ...points, xpInLevel, xpToNextLevel: this.LEVEL_XP, allBadges };
    }

    async getLeaderboard(limit = 10) {
        return this.prisma.userPoints.findMany({
            take: limit,
            orderBy: { points: 'desc' },
            include: { user: { select: { id: true, email: true } } },
        });
    }
}
