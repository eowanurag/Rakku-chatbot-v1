import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmergencyRepository } from './emergency.repository';
import { Prisma } from '@prisma/client';
import { DashboardNotifier, TelegramNotifier, EmailNotifier } from './emergency.notifiers';

@Injectable()
export class EmergencyService implements OnModuleInit {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private readonly repo: EmergencyRepository,
    private readonly dashboardNotifier: DashboardNotifier,
    private readonly telegramNotifier: TelegramNotifier,
    private readonly emailNotifier: EmailNotifier
  ) {}

  onModuleInit() {
    this.logger.log('✅ Emergency Module Initialized');
    
    if (process.env.EMERGENCY_NOTIFICATIONS_ENABLED === 'true') {
      this.logger.log('✅ Dashboard Notifications Enabled');
      
      if (process.env.TELEGRAM_ENABLED === 'true') {
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
          this.logger.log('✅ Telegram Notifications Enabled');
        } else {
          this.logger.warn('⚠ Telegram Notifications Disabled (Missing Bot Token or Chat ID)');
        }
      } else {
        this.logger.warn('⚠ Telegram Notifications Disabled');
      }

      if (process.env.EMAIL_ENABLED === 'true') {
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
          this.logger.log('✅ Email Notifications Enabled');
        } else {
          this.logger.warn('⚠ Email Notifications Disabled (SMTP_PASS or SMTP_USER missing)');
        }
      } else {
        this.logger.warn('⚠ Email Notifications Disabled');
      }

      this.logger.warn(`⚠ WhatsApp Disabled (${process.env.WHATSAPP_ENABLED === 'true' ? 'Missing credentials' : 'By config'})`);
      this.logger.warn(`⚠ SMS Disabled (${process.env.SMS_ENABLED === 'true' ? 'Missing credentials' : 'By config'})`);
    } else {
      this.logger.warn('⚠ ALL Emergency Notifications Disabled by config');
    }
  }

  async createAlert(
    citizenId: string | null,
    ipAddress: string | null,
    triggerSource: any = 'SOS_BUTTON',
    citizenSnapshot: any = null
  ) {
    const existingAlert = citizenId ? await this.repo.getActiveAlertByCitizen(citizenId) : null;

    if (existingAlert) {
      // Handle Duplicate SOS
      const throttle = parseInt(process.env.NOTIFICATION_THROTTLE_SECONDS || '30', 10);
      const timeSinceLast = existingAlert.lastNotificationAt ? (new Date().getTime() - existingAlert.lastNotificationAt.getTime()) / 1000 : 999;
      
      const updatedAlert = await this.repo.updateAlert(existingAlert.id, {
        sosPressCount: existingAlert.sosPressCount + 1,
        lastNotificationAt: timeSinceLast > throttle ? new Date() : existingAlert.lastNotificationAt
      });

      await this.repo.appendEvent({
        alertId: updatedAlert.id,
        eventType: 'SOS_TRIGGERED_AGAIN',
        metadata: { timeSinceLast, throttled: timeSinceLast <= throttle }
      });

      if (timeSinceLast > throttle) {
        this.notifyAuthorities(updatedAlert);
      }

      return { referenceNumber: updatedAlert.referenceNumber, isDuplicate: true };
    }

    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const prefix = process.env.EMERGENCY_REFERENCE_PREFIX || 'SOS-UP';
    const referenceNumber = `${prefix}-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

    const alert = await this.repo.createAlert({
      referenceNumber,
      citizenId,
      citizenSnapshot,
      ipAddress,
      triggerSource,
      severity: (process.env.EMERGENCY_DEFAULT_SEVERITY || 'CRITICAL') as any,
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

  async cancelAlert(alertId: string) {
    const alert = await this.repo.getAlertById(alertId);
    if (!alert) throw new Error('Alert not found');
    if (alert.status !== 'ACTIVE') throw new Error('Only active alerts can be cancelled');
    if (alert.adminAcknowledged) throw new Error('Alert has already been acknowledged and cannot be cancelled');

    const updated = await this.repo.updateAlert(alertId, {
      status: 'CANCELLED'
    });

    await this.repo.appendEvent({
      alertId,
      eventType: 'ALERT_CANCELLED',
      metadata: { cancelledBy: 'CITIZEN' }
    });

    this.notifyAuthorities(updated);
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
