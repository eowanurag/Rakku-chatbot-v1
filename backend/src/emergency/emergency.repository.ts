import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class EmergencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAlert(data: Prisma.EmergencyAlertUncheckedCreateInput) {
    return this.prisma.emergencyAlert.create({
      data,
      include: { events: true }
    });
  }

  async getActiveAlertByCitizen(citizenId: string) {
    return this.prisma.emergencyAlert.findFirst({
      where: {
        citizenId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' }
    });
  }
  
  async getAlertById(id: string) {
    return this.prisma.emergencyAlert.findUnique({
      where: { id },
      include: { events: true }
    });
  }

  async updateAlert(id: string, data: Prisma.EmergencyAlertUncheckedUpdateInput) {
    return this.prisma.emergencyAlert.update({
      where: { id },
      data,
      include: { events: true }
    });
  }

  async appendEvent(data: Prisma.EmergencyAlertEventUncheckedCreateInput) {
    return this.prisma.emergencyAlertEvent.create({
      data
    });
  }
  
  async getRecentAlerts(limit: number = 50) {
    return this.prisma.emergencyAlert.findMany({
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: { events: true }
    });
  }

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alerts = await this.prisma.emergencyAlert.findMany({
      where: {
        createdAt: { gte: today }
      }
    });

    return {
      active: alerts.filter(a => a.status === 'ACTIVE').length,
      acknowledged: alerts.filter(a => a.status === 'ACKNOWLEDGED').length,
      resolvedToday: alerts.filter(a => a.status === 'RESOLVED').length
    };
  }
}
