import { Injectable, Logger } from '@nestjs/common';
import { EmergencyAlert, EmergencyAlertEvent } from '@prisma/client';
import axios from 'axios';
import { Resend } from 'resend';
import { EmergencyGateway } from './emergency.gateway';

export interface EmergencyNotifier {
  notify(alert: EmergencyAlert, events?: EmergencyAlertEvent[]): Promise<boolean>;
}

@Injectable()
export class TelegramNotifier implements EmergencyNotifier {
  private readonly logger = new Logger(TelegramNotifier.name);

  async notify(alert: EmergencyAlert, events?: EmergencyAlertEvent[]): Promise<boolean> {
    if (process.env.TELEGRAM_ENABLED !== 'true') return true;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      this.logger.warn('Telegram credentials missing, skipping notification.');
      return false;
    }

    const isCancelled = alert.status === 'CANCELLED';
    const headerTitle = isCancelled ? '⚪ SOS CANCELLED' : '🚨 NEW SOS ALERT';

    const message = `${isCancelled ? '⚪' : '🚨'} <b>${headerTitle}</b>
Reference: ${alert.referenceNumber}
Status: ${alert.status}
Severity: ${alert.severity}

Citizen: ${alert.citizenSnapshot ? (alert.citizenSnapshot as any).fullName || 'Unknown' : 'Unknown'}
Mobile: ${alert.citizenSnapshot ? (alert.citizenSnapshot as any).mobileNumber || 'Unknown' : 'Unknown'}

Location: ${alert.locationText || 'Pending'}
GPS: ${alert.latitude ? alert.latitude + ', ' + alert.longitude : 'Pending'}

Trigger: ${alert.triggerSource}
Time: ${alert.createdAt.toLocaleString()}

Please open the Rakku Admin Dashboard.`;

    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      });
      return true;
    } catch (e) {
      this.logger.error(`Telegram notification failed: ${e.message}`);
      return false;
    }
  }
}

@Injectable()
export class EmailNotifier implements EmergencyNotifier {
  private readonly logger = new Logger(EmailNotifier.name);

  async notify(alert: EmergencyAlert, events?: EmergencyAlertEvent[]): Promise<boolean> {
    if (process.env.EMAIL_ENABLED !== 'true') return true;
    
    if (!process.env.RESEND_API_KEY) {
      this.logger.warn('RESEND_API_KEY missing, skipping email notification.');
      return false;
    }

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);

      const isCancelled = alert.status === 'CANCELLED';
      const headerTitle = isCancelled ? '⚪ SOS CANCELLED' : '🚨 NEW SOS ALERT';

      const message = `
      <h2>${isCancelled ? '⚪' : '🚨'} ${headerTitle}</h2>
      <p><b>Reference:</b> ${alert.referenceNumber}</p>
      <p><b>Status:</b> ${alert.status}</p>
      <p><b>Severity:</b> ${alert.severity}</p>
      <br/>
      <p><b>Citizen:</b> ${alert.citizenSnapshot ? (alert.citizenSnapshot as any).fullName || 'Unknown' : 'Unknown'}</p>
      <p><b>Mobile:</b> ${alert.citizenSnapshot ? (alert.citizenSnapshot as any).mobileNumber || 'Unknown' : 'Unknown'}</p>
      <br/>
      <p><b>Trigger:</b> ${alert.triggerSource}</p>
      <p><b>Time:</b> ${alert.createdAt.toLocaleString()}</p>
      <br/>
      <p>Please log in to the Rakku Admin Dashboard immediately.</p>
      `;

      const response = await resend.emails.send({
        from: 'Rakku Emergency <onboarding@resend.dev>',
        to: process.env.ALERT_EMAIL || 'rakkuadmin@gmail.com',
        subject: `${isCancelled ? '⚪' : '🚨'} URGENT: SOS Alert ${alert.referenceNumber}`,
        html: message,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      this.logger.log(`Email successfully sent via Resend for alert ${alert.referenceNumber}`);
      return true;
    } catch (e) {
      this.logger.error(`Resend notification failed: ${e.message}`);
      return false;
    }
  }
}

@Injectable()
export class DashboardNotifier implements EmergencyNotifier {
  constructor(private readonly gateway: EmergencyGateway) {}

  async notify(alert: EmergencyAlert, events?: EmergencyAlertEvent[]): Promise<boolean> {
    this.gateway.broadcastNewAlert(alert);
    return true;
  }

  async notifyUpdate(alert: EmergencyAlert): Promise<boolean> {
    this.gateway.broadcastAlertUpdate(alert);
    return true;
  }
}
