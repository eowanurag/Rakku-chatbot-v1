import { Injectable, Logger } from '@nestjs/common';
import { EmergencyAlert, EmergencyAlertEvent } from '@prisma/client';
import axios from 'axios';
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

    const message = `🚨 *NEW SOS ALERT*
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
        parse_mode: 'Markdown'
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
    
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      this.logger.warn('Email credentials (SMTP_USER / SMTP_PASS) missing, skipping notification.');
      return false;
    }

    // Stub implementation as per V1 prototype requirements 
    // Usually uses nodemailer here
    this.logger.log(`Simulating Email sent from ${process.env.SMTP_FROM || 'Rakku'} to ${process.env.ALERT_EMAIL || 'rakkuadmin@gmail.com'} for alert ${alert.referenceNumber}`);
    
    return true;
  }
}

@Injectable()
export class DashboardNotifier implements EmergencyNotifier {
  constructor(private readonly gateway: EmergencyGateway) {}

  async notify(alert: EmergencyAlert, events?: EmergencyAlertEvent[]): Promise<boolean> {
    this.gateway.broadcastNewAlert(alert);
    return true;
  }
}
