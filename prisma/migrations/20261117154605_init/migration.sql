-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CAREER_SERVICES', 'LEADERSHIP');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('employed_full_time', 'employed_part_time', 'freelance_contract', 'internship', 'further_study', 'searching', 'not_searching', 'unknown');

-- CreateEnum
CREATE TYPE "JobSearchStatus" AS ENUM ('active', 'open_to_offers', 'not_looking');

-- CreateEnum
CREATE TYPE "RemotePreference" AS ENUM ('remote_only', 'hybrid', 'onsite', 'any');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'other');

-- CreateEnum
CREATE TYPE "SalaryBand" AS ENUM ('band_0_500', 'band_500_1000', 'band_1000_1500', 'band_1500_2500', 'band_2500_4000', 'band_4000_plus', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('survey_1m', 'survey_3m', 'survey_6m', 'survey_12m', 'self_update', 'staff_entry', 'csv_import', 'referral_hire');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('outcomes_reporting', 'job_matching', 'share_with_partners', 'marketing_testimonial');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('scheduled', 'sent', 'completed', 'skipped_recent_update', 'missed', 'bounced', 'cancelled');

-- CreateEnum
CREATE TYPE "EmailState" AS ENUM ('pending', 'sending', 'sent', 'failed', 'uncertain', 'dead', 'suppressed');

-- CreateEnum
CREATE TYPE "RemoteMode" AS ENUM ('remote', 'hybrid', 'onsite');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('intern', 'junior', 'mid', 'senior');

-- CreateEnum
CREATE TYPE "OpeningStatus" AS ENUM ('pending_moderation', 'open', 'paused', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "MatchResponse" AS ENUM ('interested', 'not_interested');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('suggested', 'graduate_interested', 'referred', 'interviewing', 'offer', 'hired', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'graduate', 'partner', 'system');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'LEADERSHIP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "graduationDate" DATE,
    "plannedSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Graduate" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "preferredName" TEXT,
    "emailEnc" TEXT,
    "emailHash" TEXT,
    "phoneEnc" TEXT,
    "linkedinUrlEnc" TEXT,
    "graduationDateOverride" DATE,
    "timezone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "remotePreference" "RemotePreference" NOT NULL DEFAULT 'any',
    "openToRelocate" BOOLEAN NOT NULL DEFAULT false,
    "jobSearchStatus" "JobSearchStatus" NOT NULL DEFAULT 'active',
    "preferredRoleCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentStatus" "EmploymentStatus" NOT NULL DEFAULT 'unknown',
    "currentStatusAt" TIMESTAMP(3),
    "currentInField" BOOLEAN,
    "searchingSince" TIMESTAMP(3),
    "lastSelfUpdateAt" TIMESTAMP(3),
    "profileTokenVersion" INTEGER NOT NULL DEFAULT 1,
    "unsubscribedAt" TIMESTAMP(3),
    "contactPrefs" JSONB NOT NULL DEFAULT '{}',
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Graduate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillSynonym" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "SkillSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraduateSkill" (
    "graduateId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "GraduateSkill_pkey" PRIMARY KEY ("graduateId","skillId")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "industry" TEXT,
    "isPartner" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMergeSuggestion" (
    "id" TEXT NOT NULL,
    "sourceCompanyId" TEXT NOT NULL,
    "targetCompanyId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMergeSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentRecord" (
    "id" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "status" "EmploymentStatus" NOT NULL,
    "companyId" TEXT,
    "roleTitle" TEXT,
    "roleCategory" TEXT,
    "inField" BOOLEAN,
    "startDate" DATE,
    "endDate" DATE,
    "employmentType" "EmploymentType",
    "salaryBand" "SalaryBand",
    "source" "RecordSource" NOT NULL,
    "surveyInstanceId" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "createdById" TEXT,
    "supersedesId" TEXT,
    "searchBlockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "helpWanted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyInstance" (
    "id" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "milestone" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "SurveyStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyInstanceId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "graduateId" TEXT,
    "kind" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" "EmailState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeCode" (
    "id" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "PartnerContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opening" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "roleCategory" TEXT,
    "city" TEXT,
    "country" TEXT,
    "remoteMode" "RemoteMode" NOT NULL DEFAULT 'onsite',
    "seniority" "Seniority" NOT NULL DEFAULT 'junior',
    "salaryBand" "SalaryBand",
    "deadline" DATE,
    "status" "OpeningStatus" NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "submittedByPartnerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningSkill" (
    "openingId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 3,
    "mustHave" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OpeningSkill_pkey" PRIMARY KEY ("openingId","skillId")
);

-- CreateTable
CREATE TABLE "MatchNotification" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "response" "MatchResponse",
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "MatchNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "graduateId" TEXT NOT NULL,
    "referredById" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'suggested',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "hireRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralTransition" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "fromStatus" "ReferralStatus",
    "toStatus" "ReferralStatus" NOT NULL,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ReferralTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Program_name_key" ON "Program"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Cohort_name_key" ON "Cohort"("name");

-- CreateIndex
CREATE INDEX "Cohort_programId_idx" ON "Cohort"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "Graduate_emailHash_key" ON "Graduate"("emailHash");

-- CreateIndex
CREATE INDEX "Graduate_cohortId_idx" ON "Graduate"("cohortId");

-- CreateIndex
CREATE INDEX "Graduate_currentStatus_idx" ON "Graduate"("currentStatus");

-- CreateIndex
CREATE INDEX "Graduate_currentStatusAt_idx" ON "Graduate"("currentStatusAt");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_canonicalName_key" ON "Skill"("canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "SkillSynonym_alias_key" ON "SkillSynonym"("alias");

-- CreateIndex
CREATE INDEX "GraduateSkill_skillId_idx" ON "GraduateSkill"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_canonicalName_key" ON "Company"("canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_alias_key" ON "CompanyAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMergeSuggestion_sourceCompanyId_targetCompanyId_key" ON "CompanyMergeSuggestion"("sourceCompanyId", "targetCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentRecord_surveyInstanceId_key" ON "EmploymentRecord"("surveyInstanceId");

-- CreateIndex
CREATE INDEX "EmploymentRecord_graduateId_reportedAt_idx" ON "EmploymentRecord"("graduateId", "reportedAt");

-- CreateIndex
CREATE INDEX "EmploymentRecord_companyId_idx" ON "EmploymentRecord"("companyId");

-- CreateIndex
CREATE INDEX "Consent_graduateId_purpose_idx" ON "Consent"("graduateId", "purpose");

-- CreateIndex
CREATE INDEX "SurveyInstance_status_scheduledFor_idx" ON "SurveyInstance"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyInstance_graduateId_milestone_key" ON "SurveyInstance"("graduateId", "milestone");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_surveyInstanceId_key" ON "SurveyResponse"("surveyInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_idempotencyKey_key" ON "OutboundEmail"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundEmail_state_sendAfter_idx" ON "OutboundEmail"("state", "sendAfter");

-- CreateIndex
CREATE INDEX "OneTimeCode_graduateId_purpose_idx" ON "OneTimeCode"("graduateId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerContact_emailHash_key" ON "PartnerContact"("emailHash");

-- CreateIndex
CREATE INDEX "Opening_status_idx" ON "Opening"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MatchNotification_openingId_graduateId_key" ON "MatchNotification"("openingId", "graduateId");

-- CreateIndex
CREATE INDEX "Referral_status_idx" ON "Referral"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_openingId_graduateId_key" ON "Referral"("openingId", "graduateId");

-- CreateIndex
CREATE INDEX "ReferralTransition_referralId_at_idx" ON "ReferralTransition"("referralId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Graduate" ADD CONSTRAINT "Graduate_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillSynonym" ADD CONSTRAINT "SkillSynonym_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraduateSkill" ADD CONSTRAINT "GraduateSkill_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraduateSkill" ADD CONSTRAINT "GraduateSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMergeSuggestion" ADD CONSTRAINT "CompanyMergeSuggestion_sourceCompanyId_fkey" FOREIGN KEY ("sourceCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMergeSuggestion" ADD CONSTRAINT "CompanyMergeSuggestion_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentRecord" ADD CONSTRAINT "EmploymentRecord_surveyInstanceId_fkey" FOREIGN KEY ("surveyInstanceId") REFERENCES "SurveyInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyInstance" ADD CONSTRAINT "SurveyInstance_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyInstanceId_fkey" FOREIGN KEY ("surveyInstanceId") REFERENCES "SurveyInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeCode" ADD CONSTRAINT "OneTimeCode_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opening" ADD CONSTRAINT "Opening_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opening" ADD CONSTRAINT "Opening_submittedByPartnerId_fkey" FOREIGN KEY ("submittedByPartnerId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opening" ADD CONSTRAINT "Opening_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningSkill" ADD CONSTRAINT "OpeningSkill_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningSkill" ADD CONSTRAINT "OpeningSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchNotification" ADD CONSTRAINT "MatchNotification_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchNotification" ADD CONSTRAINT "MatchNotification_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchNotification" ADD CONSTRAINT "MatchNotification_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "Opening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_graduateId_fkey" FOREIGN KEY ("graduateId") REFERENCES "Graduate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransition" ADD CONSTRAINT "ReferralTransition_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralTransition" ADD CONSTRAINT "ReferralTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
