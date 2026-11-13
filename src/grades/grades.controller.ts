import { Controller, Get, Post, Patch, Delete, Put, Param, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GradesService } from './grades.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';

const STAFF_ROLES = [Role.ADMIN, Role.COURSE_MANAGER, Role.INSTRUCTOR];

@ApiTags('Grades & Roster (الطلاب والدرجات)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(...STAFF_ROLES)
@Controller()
export class GradesController {
    constructor(private readonly gradesService: GradesService) { }

    @ApiOperation({ summary: 'Roster of enrolled students + grades for an opening (own openings only for instructors)' })
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get('openings/:openingId/roster')
    roster(@Param('openingId') openingId: string, @Request() req: any) {
        return this.gradesService.getRoster(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Unified gradebook for an opening' })
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get('openings/:openingId/gradebook')
    gradebook(@Param('openingId') openingId: string, @Request() req: any) {
        return this.gradesService.getGradebook(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Save weighted grade categories (weights must total 100%)' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Put('openings/:openingId/gradebook/categories')
    saveGradebookCategories(
        @Param('openingId') openingId: string,
        @Body('categories') categories: { id?: string; nameAr: string; nameEn: string; weightPercent: number }[],
        @Request() req: any,
    ) {
        return this.gradesService.saveGradebookCategories(openingId, categories, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Assign gradebook items to weighted categories' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Put('openings/:openingId/gradebook/items')
    saveGradebookItems(
        @Param('openingId') openingId: string,
        @Body('items') items: { sourceType: 'assessment' | 'task' | 'quiz' | 'attendance'; sourceId: string; categoryId: string | null }[],
        @Request() req: any,
    ) {
        return this.gradesService.saveGradebookItems(openingId, items, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Override an automatic grade without changing its source record' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Put('openings/:openingId/gradebook/overrides')
    setGradeOverride(
        @Param('openingId') openingId: string,
        @Body('enrollmentId') enrollmentId: string,
        @Body('sourceType') sourceType: 'task' | 'quiz' | 'attendance',
        @Body('sourceId') sourceId: string,
        @Body('score') score: number,
        @Body('notes') notes: string | undefined,
        @Request() req: any,
    ) {
        if (!enrollmentId || !sourceId || score == null) {
            throw new BadRequestException('enrollmentId, sourceId, and score are required');
        }
        return this.gradesService.setGradeOverride(
            openingId,
            enrollmentId,
            sourceType,
            sourceId,
            score,
            notes,
            req.user.userId,
            req.user.role,
        );
    }

    @ApiOperation({ summary: 'Clear a grade override and restore the original grade' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Delete('openings/:openingId/gradebook/overrides/:enrollmentId/:sourceType/:sourceId')
    clearGradeOverride(
        @Param('openingId') openingId: string,
        @Param('enrollmentId') enrollmentId: string,
        @Param('sourceType') sourceType: 'task' | 'quiz' | 'attendance',
        @Param('sourceId') sourceId: string,
        @Request() req: any,
    ) {
        return this.gradesService.clearGradeOverride(
            openingId,
            enrollmentId,
            sourceType,
            sourceId,
            req.user.userId,
            req.user.role,
        );
    }

    @ApiOperation({ summary: 'List assessment components for an opening (own openings only for instructors)' })
    @RequirePermissions(PERMISSIONS.GRADES_READ)
    @Get('openings/:openingId/assessments')
    assessments(@Param('openingId') openingId: string, @Request() req: any) {
        return this.gradesService.listAssessments(openingId, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Create an assessment component' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Post('openings/:openingId/assessments')
    createAssessment(
        @Param('openingId') openingId: string,
        @Body('nameAr') nameAr: string,
        @Body('nameEn') nameEn: string,
        @Body('maxScore') maxScore: number | undefined,
        @Body('orderIndex') orderIndex: number | undefined,
        @Request() req: any,
    ) {
        return this.gradesService.createAssessment(openingId, { nameAr, nameEn, maxScore, orderIndex }, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Update an assessment component' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Patch('assessments/:id')
    updateAssessment(
        @Param('id') id: string,
        @Body('nameAr') nameAr: string | undefined,
        @Body('nameEn') nameEn: string | undefined,
        @Body('maxScore') maxScore: number | undefined,
        @Body('orderIndex') orderIndex: number | undefined,
        @Request() req: any,
    ) {
        return this.gradesService.updateAssessment(id, { nameAr, nameEn, maxScore, orderIndex }, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Delete an assessment component' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Delete('assessments/:id')
    deleteAssessment(@Param('id') id: string, @Request() req: any) {
        return this.gradesService.deleteAssessment(id, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Create or update a grade for an enrollment + assessment' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Put('grades')
    upsertGrade(
        @Body('enrollmentId') enrollmentId: string,
        @Body('assessmentId') assessmentId: string,
        @Body('score') score: number,
        @Body('notes') notes: string | undefined,
        @Request() req: any,
    ) {
        if (enrollmentId == null || assessmentId == null || score == null) {
            throw new BadRequestException('enrollmentId, assessmentId and score are required');
        }
        return this.gradesService.upsertGrade({ enrollmentId, assessmentId, score, notes }, req.user.userId, req.user.role);
    }

    @ApiOperation({ summary: 'Delete a grade' })
    @RequirePermissions(PERMISSIONS.GRADES_WRITE)
    @Delete('grades/:enrollmentId/:assessmentId')
    deleteGrade(@Param('enrollmentId') enrollmentId: string, @Param('assessmentId') assessmentId: string, @Request() req: any) {
        return this.gradesService.deleteGrade(enrollmentId, assessmentId, req.user.userId, req.user.role);
    }
}