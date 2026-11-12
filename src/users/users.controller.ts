import { Controller, Get, Param, Patch, Body, Delete, UseGuards, Request, Ip, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions/permissions';
import { Role } from '@prisma/client';
import { CreateUserDto, UpdateUserDto, UpdateMeDto } from './dto/user.dto';
import { createUploadStorage } from '../common/upload-storage';

const ALLOWED_AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

@ApiTags('Users & Roles')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @ApiResponse({ status: 200, description: 'Returns all users.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.USERS_READ)
    @Get()
    findAll() {
        return this.usersService.findAll();
    }

    @ApiOperation({ summary: 'Get the current authenticated user profile (+ role-specific stats)' })
    @ApiResponse({ status: 200, description: 'Returns the current user profile and stats.' })
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Get('me')
    getMe(@Request() req: any) {
        return this.usersService.getMe(req.user.userId);
    }

    @ApiOperation({ summary: 'Update the current user personal info / email / password' })
    @ApiResponse({ status: 200, description: 'Returns the updated user profile.' })
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Patch('me')
    updateMe(@Body() dto: UpdateMeDto, @Request() req: any) {
        return this.usersService.updateMe(req.user.userId, dto);
    }

    /**
     * The filename is generated server-side and the extension is derived from
     * the validated MIME type, so clients cannot choose storage paths.
     */
    @ApiOperation({ summary: 'Upload a profile picture for the current user' })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({ status: 201, description: 'Returns the public path of the stored avatar.' })
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Post('me/avatar')
    @UseInterceptors(FileInterceptor('file', {
        storage: createUploadStorage({
            destination: () => './uploads/avatars',
            filename: (_req, file) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/gif': '.gif',
                };
                return `avatar-${uniqueSuffix}${mimeToExt[file.mimetype] || '.bin'}`;
            },
        }),
        limits: {
            fileSize: AVATAR_MAX_BYTES,
            files: 1,
            // fieldSize caps each non-file form field. Without it a "multipart"
            // field can carry megabytes, which lands in memory rather than on
            // the 500MB volume -- the cheapest way to turn an upload endpoint
            // into a memory DoS.
            fields: 10,
            fieldSize: 1 * 1024 * 1024,
            parts: 15,
        },
        fileFilter: (req, file, cb) => {
            if (ALLOWED_AVATAR_MIMES.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new BadRequestException('Only JPEG, PNG, WEBP or GIF images are allowed.'), false);
            }
        },
    }))
    uploadAvatar(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
        if (!file) throw new BadRequestException('No image was uploaded.');
        return this.usersService.setAvatar(req.user.userId, file);
    }

    @ApiOperation({ summary: 'Export all of my personal data (GDPR)' })
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Post('me/export')
    exportMyData(@Request() req: any) {
        return this.usersService.exportMyData(req.user.userId);
    }

    @ApiOperation({ summary: 'Delete my own account (GDPR erasure)' })
    @Roles(Role.STUDENT, Role.INSTRUCTOR, Role.COURSE_MANAGER, Role.FINANCE, Role.ADMIN)
    @Delete('me')
    deleteMe(@Body('currentPassword') currentPassword: string, @Request() req: any) {
        return this.usersService.deleteMyAccount(req.user.userId, currentPassword);
    }

    @ApiOperation({ summary: 'Create a new user (Admin only)' })
    @ApiResponse({ status: 201, description: 'User created.' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_WRITE)
    @Post()
    create(@Body() dto: CreateUserDto, @Request() req: any, @Ip() ip: string) {
        return this.usersService.create(dto, req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Get full user details (profile, courses, certificates) (Admin / Course Manager)' })
    @ApiResponse({ status: 200, description: 'Returns user profile, enrollments and certificates.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.USERS_READ)
    @Get(':id/details')
    getDetails(@Param('id') id: string) {
        return this.usersService.getDetails(id);
    }

    @ApiOperation({ summary: 'Get specific user profile' })
    @ApiResponse({ status: 200, description: 'Returns user profile and metadata.' })
    @Roles(Role.ADMIN, Role.COURSE_MANAGER)
    @RequirePermissions(PERMISSIONS.USERS_READ)
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @ApiOperation({ summary: 'Update user account (email/password/role/activate-suspend) (Admin only)' })
    @ApiResponse({ status: 200, description: 'User updated.' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_WRITE)
    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateUserDto,
        @Request() req: any,
        @Ip() ip: string
    ) {
        return this.usersService.update(id, dto, req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Control whether an instructor appears in the public instructors directory' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_WRITE)
    @Patch(':id/public-instructors-page')
    setPublicInstructorVisibility(
        @Param('id') id: string,
        @Body('visible') visible: boolean,
        @Request() req: any,
        @Ip() ip: string
    ) {
        if (typeof visible !== 'boolean') {
            throw new BadRequestException('visible must be a boolean');
        }
        return this.usersService.setPublicInstructorVisibility(id, visible, req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Change user role (Admin only)' })
    @ApiResponse({ status: 200, description: 'User role updated.' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_ROLE)
    @Patch(':id/role')
    updateRole(
        @Param('id') id: string,
        @Body('role') role: Role,
        @Request() req: any,
        @Ip() ip: string
    ) {
        return this.usersService.updateRole(id, role, req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Disable two-factor authentication for a user (Admin only)' })
    @ApiResponse({ status: 200, description: 'Two-factor authentication disabled and the user sessions revoked.' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_WRITE)
    @Patch(':id/two-factor/disable')
    disableUserTwoFactor(@Param('id') id: string, @Request() req: any, @Ip() ip: string) {
        return this.usersService.disableUserTwoFactor(id, req.user.userId, ip);
    }

    @ApiOperation({ summary: 'Delete user account (Admin only)' })
    @ApiResponse({ status: 200, description: 'User permanently deleted.' })
    @Roles(Role.ADMIN)
    @RequirePermissions(PERMISSIONS.USERS_DELETE)
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req: any, @Ip() ip: string) {
        return this.usersService.remove(id, req.user.userId, ip);
    }
}
