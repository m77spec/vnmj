"use client";

import ProtectedRoute from '@/components/ProtectedRoute';
import AcademicCalendar from '@/components/AcademicCalendar';

export default function StudentCalendarPage() {
    return (
        <ProtectedRoute allowedRoles={['STUDENT']}>
            <div className="animate-fade-in space-y-6">
                <AcademicCalendar />
            </div>
        </ProtectedRoute>
    );
}
