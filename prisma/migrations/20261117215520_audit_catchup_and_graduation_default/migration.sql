-- AlterEnum
ALTER TYPE "RecordSource" ADD VALUE 'graduation_default';

-- AlterTable
ALTER TABLE "SurveyInstance" ADD COLUMN     "catchUp" BOOLEAN NOT NULL DEFAULT false;
