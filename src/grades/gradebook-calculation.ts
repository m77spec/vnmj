export interface WeightedGradeCategory {
    id: string;
    weightPercent: number;
}

export interface WeightedGradeItem {
    categoryId: string | null;
    maxScore: number;
    scores: Record<string, { score: number | null }>;
}

export interface WeightedGradeSummary {
    percentage: number | null;
    coveragePercent: number;
}

export function calculateWeightedGrades(
    categories: WeightedGradeCategory[],
    items: WeightedGradeItem[],
    enrollmentIds: string[],
): Record<string, WeightedGradeSummary> {
    const summaries: Record<string, WeightedGradeSummary> = {};
    for (const enrollmentId of enrollmentIds) {
        let weightedTotal = 0;
        let coveredWeight = 0;
        for (const category of categories) {
            const gradedItemPercentages = items.flatMap((item) => {
                if (item.categoryId !== category.id || item.maxScore <= 0) return [];
                const score = item.scores[enrollmentId]?.score;
                return score === null || score === undefined
                    ? []
                    : [Math.min(100, Math.max(0, (score / item.maxScore) * 100))];
            });
            if (gradedItemPercentages.length === 0) continue;
            const categoryAverage = gradedItemPercentages.reduce((sum, score) => sum + score, 0) / gradedItemPercentages.length;
            weightedTotal += categoryAverage * category.weightPercent;
            coveredWeight += category.weightPercent;
        }
        summaries[enrollmentId] = {
            percentage: coveredWeight > 0 ? weightedTotal / coveredWeight : null,
            coveragePercent: coveredWeight,
        };
    }
    return summaries;
}
