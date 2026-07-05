import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export interface EmergencyAlertData {
  id: string;
  referenceNumber: string;
  status: string;
  adminAcknowledged: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationText?: string | null;
  emergencyType?: string;
  citizenSnapshot?: any;
  createdAt: string;
}

export const useEmergencySocket = (backendUrl: string, activeAlertId: string | null) => {
  const [liveAlert, setLiveAlert] = useState<EmergencyAlertData | null>(null);

  useEffect(() => {
    if (!activeAlertId) {
      setLiveAlert(null);
      return;
    }

    const socketUrl = backendUrl.replace('/api', '') + '/emergency';
    const socket: Socket = io(socketUrl, {
      transports: ['websocket'],
    });

    socket.on('alert_updated', (alert: EmergencyAlertData) => {
      if (alert.id === activeAlertId) {
        setLiveAlert(alert);
      }
    });

    socket.on('new_alert', (alert: EmergencyAlertData) => {
      if (alert.id === activeAlertId) {
        setLiveAlert(alert);
      }
    });

    // Cleanup
    return () => {
      socket.disconnect();
    };
  }, [backendUrl, activeAlertId]);

  return { liveAlert, setLiveAlert };
};
