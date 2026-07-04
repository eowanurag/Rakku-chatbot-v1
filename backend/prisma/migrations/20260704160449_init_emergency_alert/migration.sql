-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EmergencySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EmergencyLocationSource" AS ENUM ('GPS', 'MANUAL', 'PROFILE', 'IP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmergencyLocationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "EmergencyEventType" AS ENUM ('ALERT_CREATED', 'GPS_UPDATED', 'LOCATION_UPDATED', 'CONTACT_UPDATED', 'SOS_TRIGGERED_AGAIN', 'ACKNOWLEDGED', 'RESOLVED', 'ADMIN_NOTE', 'NOTIFICATION_SENT', 'NOTIFICATION_FAILED');

-- CreateEnum
CREATE TYPE "EmergencyType" AS ENUM ('UNKNOWN', 'MEDICAL', 'CRIME', 'ACCIDENT', 'FIRE', 'WOMEN_SAFETY', 'CHILD', 'OTHER');

-- CreateEnum
CREATE TYPE "EmergencyTriggerSource" AS ENUM ('CHAT', 'SOS_BUTTON', 'VOICE', 'API', 'UNKNOWN');

-- CreateTable
CREATE TABLE "EmergencyAlert" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "externalReference" TEXT,
    "citizenId" TEXT,
    "citizenSnapshot" JSONB,
    "citizenSnapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "emergencyType" "EmergencyType" NOT NULL DEFAULT 'UNKNOWN',
    "triggerSource" "EmergencyTriggerSource" NOT NULL DEFAULT 'SOS_BUTTON',
    "severity" "EmergencySeverity" NOT NULL DEFAULT 'CRITICAL',
    "locationSource" "EmergencyLocationSource" NOT NULL DEFAULT 'UNKNOWN',
    "locationConfidence" "EmergencyLocationConfidence",
    "locationText" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "ipAddress" TEXT,
    "ipApproxLocation" TEXT,
    "policeStationId" TEXT,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "sosPressCount" INTEGER NOT NULL DEFAULT 1,
    "lastNotificationAt" TIMESTAMP(3),
    "assignedToAdminId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "adminAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "eventType" "EmergencyEventType" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyAlert_referenceNumber_key" ON "EmergencyAlert"("referenceNumber");

-- AddForeignKey
ALTER TABLE "EmergencyAlert" ADD CONSTRAINT "EmergencyAlert_citizenId_fkey" FOREIGN KEY ("citizenId") REFERENCES "Citizen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAlertEvent" ADD CONSTRAINT "EmergencyAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "EmergencyAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
