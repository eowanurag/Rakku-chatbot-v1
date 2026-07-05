import React, { useState, useEffect } from 'react';
import { useEmergencySocket, EmergencyAlertData } from '../../hooks/useEmergencySocket';
import { EmergencyService } from '../../services/api';
import { MapPin, Crosshair, XCircle, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';

interface SOSDialogProps {
  activeAlertId: string | null;
  initialReferenceNumber: string | null;
  backendUrl: string;
  onClose: () => void;
}

const SOSDialog: React.FC<SOSDialogProps> = ({ activeAlertId, initialReferenceNumber, backendUrl, onClose }) => {
  const { liveAlert, setLiveAlert } = useEmergencySocket(backendUrl, activeAlertId);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locationText, setLocationText] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fallback state if socket hasn't connected yet but we know the reference
  const currentAlert = liveAlert || {
    id: activeAlertId || '',
    referenceNumber: initialReferenceNumber || 'Pending...',
    status: 'ACTIVE',
    adminAcknowledged: false,
    createdAt: new Date().toISOString()
  };

  const isCancelled = currentAlert.status === 'CANCELLED';
  const isAcknowledged = currentAlert.status === 'ACKNOWLEDGED' || currentAlert.adminAcknowledged;
  const isResolved = currentAlert.status === 'RESOLVED';
  const isActive = currentAlert.status === 'ACTIVE' && !isAcknowledged;

  const handleShareGPS = () => {
    if (gpsLoading || isCancelled || isResolved) return;
    setGpsLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            await EmergencyService.updateLocation(currentAlert.id, position.coords.latitude, position.coords.longitude, 'GPS');
            setGpsLoading(false);
            if (liveAlert) {
              setLiveAlert({ ...liveAlert, latitude: position.coords.latitude, longitude: position.coords.longitude });
            }
          } catch (e: any) {
            setErrorMsg(e.message || 'Failed to update location');
            setGpsLoading(false);
          }
        },
        (err) => {
          setErrorMsg('Location permission denied or unavailable. Please type your location.');
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      setErrorMsg('Geolocation is not supported by your browser.');
      setGpsLoading(false);
    }
  };

  const handleSelectType = async (type: string) => {
    if (loading || isCancelled || isResolved) return;
    setLoading(true);
    try {
      // EmergencyService.updateEmergencyType might not exist in api.ts, I'll assume we can call the endpoint directly or use fetch
      const res = await fetch(`${backendUrl}/emergency/${currentAlert.id}/emergency-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emergencyType: type })
      });
      if (!res.ok) throw new Error('Failed to update type');
      if (liveAlert) {
        setLiveAlert({ ...liveAlert, emergencyType: type });
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error updating emergency type');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAlert = async () => {
    if (loading || isAcknowledged || isCancelled || isResolved) return;
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/emergency/${currentAlert.id}/cancel`, {
        method: 'PATCH'
      });
      if (!res.ok) throw new Error('Failed to cancel alert');
      if (liveAlert) {
        setLiveAlert({ ...liveAlert, status: 'CANCELLED' });
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error cancelling alert');
    } finally {
      setLoading(false);
      setShowCancelConfirm(false);
    }
  };

  const getStatusBadge = () => {
    if (isCancelled) return <span className="bg-slate-700 text-slate-300 px-3 py-1 rounded-full font-bold text-sm flex items-center"><XCircle className="w-4 h-4 mr-2"/> CANCELLED</span>;
    if (isResolved) return <span className="bg-green-600/20 text-green-400 border border-green-500/50 px-3 py-1 rounded-full font-bold text-sm flex items-center"><CheckCircle className="w-4 h-4 mr-2"/> RESOLVED</span>;
    if (isAcknowledged) return <span className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 px-3 py-1 rounded-full font-bold text-sm flex items-center animate-pulse"><AlertTriangle className="w-4 h-4 mr-2"/> ACKNOWLEDGED</span>;
    return <span className="bg-red-600/20 text-red-500 border border-red-500/50 px-3 py-1 rounded-full font-bold text-sm flex items-center animate-pulse"><AlertTriangle className="w-4 h-4 mr-2"/> ACTIVE</span>;
  };

  const types = [
    { label: 'Crime', value: 'CRIME', icon: '🚓' },
    { label: 'Medical', value: 'MEDICAL', icon: '🚑' },
    { label: 'Fire', value: 'FIRE', icon: '🔥' },
    { label: 'Accident', value: 'ACCIDENT', icon: '🚗' },
    { label: 'Women\'s Safety', value: 'WOMEN_SAFETY', icon: '👩' },
    { label: 'Child', value: 'CHILD', icon: '👶' },
    { label: 'Other', value: 'OTHER', icon: '⚠' }
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className={`p-4 flex items-center justify-between ${isCancelled ? 'bg-slate-800' : 'bg-red-950/80 border-b border-red-900'}`}>
          <div className="flex items-center space-x-3">
            <ShieldAlert className={`w-6 h-6 ${isCancelled ? 'text-slate-400' : 'text-red-500 animate-pulse'}`} />
            <h2 className="text-lg font-bold text-white tracking-wide">Emergency Alert</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Status Section */}
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex flex-col items-center justify-center text-center space-y-3 shadow-inner">
            <div className="text-slate-400 text-xs font-mono tracking-widest uppercase">Reference Number</div>
            <div className="text-xl font-mono font-bold text-white">{currentAlert.referenceNumber}</div>
            <div className="mt-2">{getStatusBadge()}</div>
            
            {isActive && <p className="text-red-400 text-xs font-medium mt-2">Authorities have been notified.<br/>Please provide additional information if you can.</p>}
            {isAcknowledged && !isResolved && <p className="text-yellow-400 text-xs font-medium mt-2">Control room has acknowledged your alert.<br/>Help is being coordinated.</p>}
          </div>

          {errorMsg && (
            <div className="bg-red-900/50 border border-red-500/50 text-red-200 text-xs p-3 rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Form Content - Disabled if Cancelled or Resolved */}
          <div className={`space-y-6 ${isCancelled || isResolved ? 'opacity-50 pointer-events-none' : ''}`}>
            
            {/* Location Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center"><MapPin className="w-4 h-4 mr-2" /> Share My Current Location</h3>
              <button 
                onClick={handleShareGPS}
                disabled={gpsLoading || !!liveAlert?.latitude}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-xl font-bold transition flex items-center justify-center shadow-lg active:scale-95"
              >
                {gpsLoading ? 'Acquiring GPS...' : liveAlert?.latitude ? '📍 GPS Shared Successfully' : <><Crosshair className="w-5 h-5 mr-2"/> Share GPS</>}
              </button>
            </div>

            <hr className="border-slate-800" />

            {/* Type Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-300">Emergency Type</h3>
              <div className="grid grid-cols-2 gap-2">
                {types.map((t) => {
                  const isSelected = liveAlert?.emergencyType === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => handleSelectType(t.value)}
                      disabled={loading}
                      className={`py-3 px-2 rounded-xl font-bold flex items-center justify-center space-x-2 transition ${
                        isSelected 
                          ? 'bg-red-600 text-white border-2 border-red-400 shadow-[0_0_15px_rgba(220,38,38,0.5)]' 
                          : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      <span className="text-lg">{t.icon}</span>
                      <span className="text-sm">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Cancel Section */}
          {!isCancelled && !isResolved && (
            <div className="mt-8 pt-6 border-t border-slate-800">
              {showCancelConfirm ? (
                <div className="bg-slate-800 border border-slate-700 p-4 rounded-xl text-center space-y-4">
                  <h4 className="text-white font-bold">Are you sure?</h4>
                  <p className="text-slate-400 text-xs">Authorities have already been notified. Cancel this alert?</p>
                  <div className="flex space-x-3">
                    <button onClick={handleCancelAlert} disabled={loading} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold">Yes</button>
                    <button onClick={() => setShowCancelConfirm(false)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold">No</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isAcknowledged}
                  className={`w-full py-4 rounded-xl font-bold transition flex items-center justify-center ${
                    isAcknowledged 
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' 
                      : 'bg-transparent text-slate-400 border border-slate-600 hover:bg-slate-800 hover:text-white hover:border-slate-500'
                  }`}
                >
                  <span className="text-lg mr-2">⚪</span> Cancel Emergency Alert
                </button>
              )}
              {isAcknowledged && (
                <p className="text-slate-500 text-[10px] mt-3 text-center px-4">
                  Your emergency has already been acknowledged by the control room. This alert can no longer be cancelled. If this was accidental, please wait for the responding authority.
                </p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SOSDialog;
