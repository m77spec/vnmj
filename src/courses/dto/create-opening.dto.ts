import { IsString, IsOptional, IsNumber, Min, Max, IsInt, IsDateString, IsEnum, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryMode } from '@prisma/client';
import { toIsoDate } from '../../common/date-transform';

export class CreateOpeningDto {
    @ApiPropertyOptional({ description: 'Optional Arabic label for this opening (e.g. "دفعة سبتمبر")' })
    @IsOptional()
    @IsString()
    nameAr?: string;

    @ApiPropertyOptional({ description: 'Optional English label for this opening (e.g. "September batch")' })
    @IsOptional()
    @IsString()
    nameEn?: string;

    @ApiProperty({ description: 'Instructor teaching this opening/batch' })
    @IsString()
    instructorId!: string;

    @ApiPropertyOptional({ description: 'Opening start date (ISO)' })
    @IsOptional()
    @IsDateString()
    @Transform(toIsoDate)
    startDate?: string;

    @ApiPropertyOptional({ description: 'Opening end date (ISO)' })
    @IsOptional()
    @IsDateString()
    @Transform(toIsoDate)
    endDate?: string;

    @ApiPropertyOptional({ description: 'Enrollment deadline (ISO)' })
    @IsOptional()
    @IsDateString()
    @Transform(toIsoDate)
    enrollmentDeadline?: string;

    @ApiProperty({ description: 'Price of this opening', example: 199.99 })
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price!: number;

    @ApiPropertyOptional({ description: 'Currency code for this opening', enum: ['YER', 'SAR', 'USD', 'AED', 'EUR', 'GBP', 'EGP', 'KWD', 'BHD', 'OMR', 'QAR'], example: 'YER', default: 'SAR' })
    @IsOptional()
    @IsIn(['YER', 'SAR', 'USD', 'AED', 'EUR', 'GBP', 'EGP', 'KWD', 'BHD', 'OMR', 'QAR'], { message: 'currency must be a supported currency code' })
    currency?: string;

    @ApiPropertyOptional({ description: 'Original price before discount', example: 299.99 })
    @Type(() => Number)
    @IsOptional()
    @IsNumber()
    @Min(0)
    priceOld?: number;

    @ApiPropertyOptional({ description: 'Maximum number of students for this opening' })
    @Type(() => Number)
    @IsOptional()
    @IsInt()
    @Min(1)
    maxStudents?: number;

    @ApiPropertyOptional({
        description: 'Days after the start date during which a student may request a refund. Omit/null = refunds disabled.',
        example: 3,
    })
    @Type(() => Number)
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(365)
    refundWindowDays?: number | null;

    @ApiPropertyOptional({ description: 'Announcement banner start (ISO)' })
    @IsOptional()
    @IsDateString()
    @Transform(toIsoDate)
    announcementStartAt?: string;

    @ApiPropertyOptional({ description: 'Announcement banner end (ISO)' })
    @IsOptional()
    @IsDateString()
    @Transform(toIsoDate)
    announcementEndAt?: string;

    @ApiPropertyOptional({
        description: 'ONLINE when the batch is taught remotely, IN_PERSON otherwise',
        enum: DeliveryMode,
        default: DeliveryMode.IN_PERSON,
    })
    @IsOptional()
    @IsEnum(DeliveryMode, { message: 'deliveryMode must be IN_PERSON or ONLINE' })
    deliveryMode?: DeliveryMode;

    @ApiPropertyOptional({
        description:
            'Classroom link for an ONLINE batch (Google Meet / Zoom / Teams, https only). ' +
            'Stored as typed but only served to students with an APPROVED enrollment. ' +
            'Cleared automatically when the batch is switched back to IN_PERSON.',
        example: 'https://meet.google.com/abc-defg-hij',
    })
    @IsOptional()
    @IsString()
    meetLink?: string;
}
