import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CourseEvaluationsService } from './course-evaluations.service';

@ApiTags('Course evaluations')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('course-evaluations')
export class CourseEvaluationsController {
  constructor(private readonly evaluations: CourseEvaluationsService) {}

  @ApiOperation({ summary: 'Get my end-of-course evaluation status' })
  @Roles(Role.STUDENT)
  @Get('my/:courseId')
  getMine(@Param('courseId') courseId: string, @Request() req: any) {
    return this.evaluations.getMine(courseId, req.user.userId);
  }

  @ApiOperation({ summary: 'Submit the required end-of-course ratings' })
  @Roles(Role.STUDENT)
  @Post('my/:courseId')
  submit(@Param('courseId') courseId: string, @Body() body: any, @Request() req: any) {
    return this.evaluations.submit(courseId, req.user.userId, body);
  }

  @ApiOperation({ summary: 'List course openings with end-of-course evaluation summaries' })
  @Roles(Role.ADMIN, Role.COURSE_MANAGER)
  @Get('admin/openings')
  listOpenings(@Request() req: any) {
    this.evaluations.assertStaffCanRead(req.user.role);
    return this.evaluations.listOpeningSummaries();
  }

  @ApiOperation({ summary: 'List individual evaluation results for an opening' })
  @Roles(Role.ADMIN, Role.COURSE_MANAGER)
  @Get('admin/openings/:openingId')
  listOpening(@Param('openingId') openingId: string, @Request() req: any) {
    this.evaluations.assertStaffCanRead(req.user.role);
    return this.evaluations.listOpeningEvaluations(openingId);
  }

  @ApiOperation({ summary: 'List courses and their configured evaluation forms' })
  @Roles(Role.ADMIN, Role.COURSE_MANAGER)
  @Get('admin/forms')
  listForms(@Request() req: any) {
    this.evaluations.assertStaffCanRead(req.user.role);
    return this.evaluations.listCourseForms();
  }

  @ApiOperation({ summary: 'Create or update a course evaluation questionnaire' })
  @Roles(Role.ADMIN, Role.COURSE_MANAGER)
  @Put('admin/courses/:courseId/form')
  saveForm(@Param('courseId') courseId: string, @Body() body: any, @Request() req: any) {
    this.evaluations.assertStaffCanRead(req.user.role);
    return this.evaluations.saveCourseForm(courseId, body, req.user.userId);
  }
}
