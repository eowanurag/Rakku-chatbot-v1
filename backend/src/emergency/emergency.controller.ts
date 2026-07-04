import { Controller, Post, Body, Get, Param, Patch, Req, Ip } from '@nestjs/common';
import { EmergencyService } from './emergency.service';
import { EmergencyRepository } from './emergency.repository';
import { Request } from 'express';

@Controller('emergency')
export class EmergencyController {
  constructor(
    private readonly emergencyService: EmergencyService,
    private readonly repo: EmergencyRepository
  ) {}

  @Post('sos')
  async triggerSos(
    @Body() body: { citizenId?: string; citizenSnapshot?: any; triggerSource?: string },
    @Req() req: Request,
    @Ip() ip: string
  ) {
    const forwardedIp = req.headers['x-forwarded-for'] as string;
    const resolvedIp = forwardedIp ? forwardedIp.split(',')[0] : ip;

    return this.emergencyService.createAlert(
      body.citizenId || null,
      resolvedIp || null,
      body.triggerSource || 'SOS_BUTTON',
      body.citizenSnapshot || null
    );
  }

  @Patch(':id/location')
  async updateLocation(
    @Param('id') id: string,
    @Body() body: { latitude: number; longitude: number; source?: string }
  ) {
    return this.emergencyService.updateLocation(id, body.latitude, body.longitude, body.source);
  }

  @Patch(':id/emergency-type')
  async updateEmergencyType(
    @Param('id') id: string,
    @Body() body: { emergencyType: string }
  ) {
    return this.emergencyService.updateEmergencyType(id, body.emergencyType);
  }

  @Get('active')
  async getActiveAlerts() {
    return this.repo.getActiveAlerts();
  }

  @Get('stats')
  async getStats() {
    return this.repo.getDashboardStats();
  }

  @Get(':id')
  async getAlertById(@Param('id') id: string) {
    return this.repo.getAlertById(id);
  }

  @Post(':id/acknowledge')
  async acknowledgeAlert(@Param('id') id: string, @Body() body: { adminId: string }) {
    return this.emergencyService.acknowledgeAlert(id, body.adminId);
  }

  @Post(':id/resolve')
  async resolveAlert(@Param('id') id: string, @Body() body: { adminId: string }) {
    return this.emergencyService.resolveAlert(id, body.adminId);
  }
}
