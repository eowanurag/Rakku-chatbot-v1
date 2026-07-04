import { Injectable, Logger } from '@nestjs/common';
import { EmergencyRepository } from './emergency.repository';
import { Prisma } from '@prisma/client';
import { DashboardNotifier, TelegramNotifier, EmailNotifier } from './emergency.notifiers';

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private readonly repo: EmergencyRepository,
    private readonly dashboardNotifier: DashboardNotifier,
    private readonly telegramNotifier: TelegramNotifier,
    private readonly emailNotifier: EmailNotifier
  ) {}

  async createAlert(
    citizenId: string | null,
    ipAddress: string | null,
    triggerSource: any = 'SOS_BUTTON',
    citizenSnapshot: any = null
  ) {
    const existingAlert = citizenId ? await this.repo.getActiveAlertByCitizen(citizenId) : null;

    if (existingAlert) {
      // Handle Duplicate SOS
      const timeSinceLast = existingAlert.lastNotificationAt ? (new Date().getTime() - existingAlert.lastNotificationAt.getTime()) / 1000 : 999;
      
      const updatedAlert = await this.repo.updateAlert(existingAlert.id, {
        sosPressCount: existingAlert.sosPressCount + 1,
        lastNotificationAt: timeSinceLast > 30 ? new Date() : existingAlert.lastNotificationAt
      });

      await this.repo.appendEvent({
        alertId: updatedAlert.id,
        eventType: 'SOS_TRIGGERED_AGAIN',
        metadata: { timeSinceLast, throttled: timeSinceLast <= 30 }
      });

      if (timeSinceLast > 30) {
        this.notifyAuthorities(updatedAlert);
      }

      return { referenceNumber: updatedAlert.referenceNumber, isDuplicate: true };
    }

    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const referenceNumber = `RK-SOS-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

    const alert = await this.repo.createAlert({
      referenceNumber,
      citizenId,
      citizenSnapshot,
      ipAddress,
      triggerSource,
      lastNotificationAt: new Date()
    });

    await this.repo.appendEvent({
      alertId: alert.id,
      eventType: 'ALERT_CREATED',
      metadata: { ipAddress, triggerSource }
    });

    this.notifyAuthorities(alert);

    return { referenceNumber: alert.referenceNumber, isDuplicate: false };
  }

  async updateLocation(alertId: string, latitude: number, longitude: number, source: any = 'GPS') {
    const updated = await this.repo.updateAlert(alertId, {
      latitude,
      longitude,
      locationSource: source,
      locationConfidence: source === 'GPS' ? 'HIGH' : 'MEDIUM'
    });

    await this.repo.appendEvent({
      alertId,
      eventType: source === 'GPS' ? 'GPS_UPDATED' : 'LOCATION_UPDATED',
      metadata: { latitude, longitude, source }
    });

    this.dashboardNotifier.notify(updated);
    return updated;
  }

  async updateEmergencyType(alertId: string, emergencyType: any) {
    const updated = await this.repo.updateAlert(alertId, { emergencyType });
    await this.repo.appendEvent({
      alertId,
      eventType: 'ADMIN_NOTE',
      metadata: { emergencyType }
    });
    this.dashboardNotifier.notify(updated);
    return updated;
  }

  async acknowledgeAlert(alertId: string, adminId: string) {
    const updated = await this.repo.updateAlert(alertId, {
      status: 'ACKNOWLEDGED',
      adminAcknowledged: true,
      assignedToAdminId: adminId,
      assignedAt: new Date()
    });

    await this.repo.appendEvent({
      alertId,
      eventType: 'ACKNOWLEDGED',
      metadata: { adminId }
    });

    this.dashboardNotifier.notify(updated);
    return updated;
  }

  async resolveAlert(alertId: string, adminId: string) {
    const updated = await this.repo.updateAlert(alertId, {
      status: 'RESOLVED'
    });

    await this.repo.appendEvent({
      alertId,
      eventType: 'RESOLVED',
      metadata: { adminId }
    });

    this.dashboardNotifier.notify(updated);
    return updated;
  }

  async notifyAuthorities(alert: any) {
    const notifiers = [
      { name: 'Dashboard', instance: this.dashboardNotifier },
      { name: 'Telegram', instance: this.telegramNotifier },
      { name: 'Email', instance: this.emailNotifier }
    ];

    for (const notifier of notifiers) {
      notifier.instance.notify(alert).then(async (success) => {
        await this.repo.appendEvent({
          alertId: alert.id,
          eventType: success ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
          metadata: { channel: notifier.name }
        });
      }).catch(async (error) => {
        await this.repo.appendEvent({
          alertId: alert.id,
          eventType: 'NOTIFICATION_FAILED',
          metadata: { channel: notifier.name, error: error.message }
        });
      });
    }
  }
}
