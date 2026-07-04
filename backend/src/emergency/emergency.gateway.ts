import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EmergencyAlert } from '@prisma/client';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'emergency'
})
export class EmergencyGateway {
  @WebSocketServer()
  server: Server;

  broadcastNewAlert(alert: EmergencyAlert) {
    this.server.emit('new_alert', alert);
  }

  broadcastAlertUpdate(alert: EmergencyAlert) {
    this.server.emit('alert_updated', alert);
  }
}
