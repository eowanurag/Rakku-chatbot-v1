import { Injectable, Logger } from '@nestjs/common';
import { EmergencyAlert, EmergencyAlertEvent } from '@prisma/client';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
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

    const message = `🚨 <b>NEW SOS ALERT</b>
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
    
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      this.logger.warn('Email credentials (SMTP_USER / SMTP_PASS) missing, skipping notification.');
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const message = `
      <h2>🚨 NEW SOS ALERT</h2>
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

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'Rakku Emergency <rakkuadmin@gmail.com>',
        to: process.env.ALERT_EMAIL || 'rakkuadmin@gmail.com',
        subject: `🚨 URGENT: SOS Alert ${alert.referenceNumber}`,
        html: message,
      });

      this.logger.log(`Email successfully sent for alert ${alert.referenceNumber}`);
      return true;
    } catch (e) {
      this.logger.error(`Email notification failed: ${e.message}`);
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
}
