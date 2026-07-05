const getBackendUrl = () => {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_BACKEND_URL || "https://rakku-chatbot-v1.onrender.com/api";
  }
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  return isLocalhost 
    ? "http://localhost:3001/api" 
    : "https://rakku-chatbot-v1.onrender.com/api";
};

const BACKEND_URL = getBackendUrl();

// Helper to make API calls or fallback
async function fetchApi(path: string, options: RequestInit = {}) {
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (e: any) {
    console.warn(`API call failed for ${path} (${e.message || e}). Triggering local frontend simulation.`);
    throw e;
  }
}

// 1. Complaint Service
export const ComplaintService = {
  async create(type: string, details: string) {
    try {
      return await fetchApi("/complaint", {
        method: "POST",
        body: JSON.stringify({ type, details }),
      });
    } catch {
      const refNum = `UP-CMP-2026-${Math.floor(100000 + Math.random() * 900000)}`;
      return {
        id: Math.random().toString(),
        referenceNumber: refNum,
        complaintType: type,
        incidentDetails: details,
        status: "Submitted",
        createdAt: new Date().toISOString(),
      };
    }
  },

  async get(refNum: string) {
    try {
      return await fetchApi(`/complaint/${refNum}`);
    } catch {
      return null;
    }
  },

  async getAll() {
    try {
      return await fetchApi("/complaint");
    } catch {
      return [];
    }
  },

  async updateStatus(refNum: string, status: string) {
    try {
      return await fetchApi(`/complaint/${refNum}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      throw e;
    }
  }
};

// 2. Verification Service
export const VerificationService = {
  async create(type: string, name: string, address: string, mobile: string, propertyDetails: string) {
    try {
      return await fetchApi("/verification", {
        method: "POST",
        body: JSON.stringify({ type, name, address, mobile, propertyDetails }),
      });
    } catch {
      const refNum = `UP-VER-2026-${Math.floor(100000 + Math.random() * 900000)}`;
      return {
        id: Math.random().toString(),
        referenceNumber: refNum,
        verificationType: type,
        name,
        address,
        mobile,
        propertyDetails,
        status: "Submitted",
        createdAt: new Date().toISOString(),
      };
    }
  },

  async get(refNum: string) {
    try {
      return await fetchApi(`/verification/${refNum}`);
    } catch {
      return null;
    }
  },

  async getAll() {
    try {
      return await fetchApi("/verification");
    } catch {
      return [];
    }
  },

  async updateStatus(refNum: string, status: string) {
    try {
      return await fetchApi(`/verification/${refNum}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      throw e;
    }
  }
};

// 3. Certificate Service
export const CertificateService = {
  async create(name: string, address: string, district: string, purpose: string) {
    try {
      return await fetchApi("/certificate", {
        method: "POST",
        body: JSON.stringify({ name, address, district, purpose }),
      });
    } catch {
      const refNum = `UP-CER-2026-${Math.floor(100000 + Math.random() * 900000)}`;
      return {
        id: Math.random().toString(),
        referenceNumber: refNum,
        name,
        address,
        district,
        purpose,
        status: "Submitted",
        createdAt: new Date().toISOString(),
      };
    }
  },

  async get(refNum: string) {
    try {
      return await fetchApi(`/certificate/${refNum}`);
    } catch {
      return null;
    }
  },

  async getAll() {
    try {
      return await fetchApi("/certificate");
    } catch {
      return [];
    }
  },

  async updateStatus(refNum: string, status: string) {
    try {
      return await fetchApi(`/certificate/${refNum}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      throw e;
    }
  }
};

// 3.5. Event Service
export const EventService = {
  async get(refNum: string) {
    try {
      return await fetchApi(`/event/${refNum}`);
    } catch {
      return null;
    }
  },

  async getAll() {
    try {
      return await fetchApi("/event");
    } catch {
      return [];
    }
  },

  async updateStatus(refNum: string, status: string) {
    try {
      return await fetchApi(`/event/${refNum}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      throw e;
    }
  }
};

// 4. Tracking Service
export const TrackingService = {
  async track(refNum: string) {
    try {
      return await fetchApi(`/tracking/${refNum}`);
    } catch {
      // Frontend Local Mock Tracking Fallback
      const refUpper = refNum.toUpperCase().trim();
      const match = [
        { prefix: "UP-CMP-", type: "Complaint Registration" },
        { prefix: "UP-VER-", type: "Tenant Verification" },
        { prefix: "UP-CER-", type: "Character Certificate" },
        { prefix: "UP-EVP-", type: "Event Permission" },
      ].find((f) => refUpper.startsWith(f.prefix));

      if (match) {
        const statuses = ["Submitted", "Under Review", "Pending Verification", "Approved", "Rejected"];
        const hash = refUpper.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return {
          referenceNumber: refUpper,
          serviceType: match.type,
          status: statuses[hash % statuses.length],
          updatedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
          details: { note: "Mock data provided directly by client." },
        };
      }
      return null;
    }
  }
};

// 5. Chat Service
export const ChatService = {
  async sendMessage(message: string, sessionId: string, latitude?: number, longitude?: number, language?: string) {
    try {
      return await fetchApi("/chat", {
        method: "POST",
        body: JSON.stringify({ message, sessionId, latitude, longitude, language }),
      });
    } catch {
      // Simulate chat stream or message locally in the UI
      return new Promise<{ response: string; suggestions?: string[] }>((resolve) => {
        setTimeout(() => {
          const cleanMsg = message.toLowerCase();
          
          if (cleanMsg.includes("danger") || cleanMsg.includes("assault") || cleanMsg.includes("emergency") || cleanMsg.includes("stolen")) {
            resolve({
              response: "⚠️ **EMERGENCY NOTICE:** This appears to be an emergency. Please contact UP Police emergency services immediately by dialing **112**.",
              suggestions: ["File Complaint", "Main Dashboard"]
            });
            return;
          }

          if (cleanMsg.includes("tenant") || cleanMsg.includes("kiraye")) {
            resolve({
              response: "📋 **[Verification Form]** Let's start Tenant Verification.\n👉 Please enter the **Full Name** of the tenant:",
              suggestions: []
            });
            return;
          }

          if (cleanMsg.includes("character") || cleanMsg.includes("charitra")) {
            resolve({
              response: "📋 **[Character Certificate]** Let's start the application.\n👉 Please enter your **Full Name**:",
              suggestions: []
            });
            return;
          }

          resolve({
            response: "👮 **Rakku (Client Standalone):** I am running in local offline demo mode. I can help you guide through services. Type 'File Complaint' or 'Tenant Verification' to start simulated workflows.\n\n📱 *For full official assistance, please download the official **UPCOP Mobile App** from the [Google Play Store](https://play.google.com/store/apps/details?id=com.up.uppolice).*",
            suggestions: ["File Complaint", "Tenant Verification", "Character Certificate", "Track Application"]
          });
        }, 800);
      });
    }
  }
};

// 6. Portal Service (General Info)


// 6. Portal Service (General Info)
export const PortalService = {
  async getQuickStats() {
    return {
      complaintsFiled: 14205,
      verificationsCleared: 95480,
      certificatesIssued: 48512,
      responseTimeMins: 12.5,
    };
  }
};

// 7. Emergency Service
export const EmergencyService = {
  async triggerSos(citizenId?: string, triggerSource: string = 'SOS_BUTTON', citizenSnapshot?: any) {
    return await fetchApi("/emergency/sos", {
      method: "POST",
      body: JSON.stringify({ citizenId, triggerSource, citizenSnapshot }),
    });
  },

  async updateLocation(id: string, latitude: number, longitude: number, source: string = 'GPS') {
    try {
      return await fetchApi(`/emergency/${id}/location`, {
        method: "PATCH",
        body: JSON.stringify({ latitude, longitude, source }),
      });
    } catch (e) {
      console.warn("Failed to update emergency location locally.");
      return null;
    }
  },

  async updateEmergencyType(id: string, emergencyType: string) {
    try {
      return await fetchApi(`/emergency/${id}/emergency-type`, {
        method: "PATCH",
        body: JSON.stringify({ emergencyType }),
      });
    } catch {
      return null;
    }
  },

  async updateDetails(id: string, details: { locationText?: string; mobileNumber?: string; isForOther?: boolean; friendMobileNumber?: string }) {
    try {
      return await fetchApi(`/emergency/${id}/details`, {
        method: "PATCH",
        body: JSON.stringify(details),
      });
    } catch {
      return null;
    }
  },

  async cancelAlert(id: string) {
    const res = await fetchApi(`/emergency/${id}/cancel`, {
      method: "PATCH",
    });
    return res;
  },

  async getActiveAlerts() {
    try {
      return await fetchApi("/emergency/active");
    } catch {
      return [];
    }
  },

  async getStats() {
    try {
      return await fetchApi("/emergency/stats");
    } catch {
      return { active: 0, acknowledged: 0, resolvedToday: 0 };
    }
  },

  async getAlertById(id: string) {
    try {
      return await fetchApi(`/emergency/${id}`);
    } catch {
      return null;
    }
  },

  async acknowledgeAlert(id: string, adminId: string) {
    try {
      return await fetchApi(`/emergency/${id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ adminId }),
      });
    } catch {
      return null;
    }
  },

  async resolveAlert(id: string, adminId: string) {
    try {
      return await fetchApi(`/emergency/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ adminId }),
      });
    } catch {
      return null;
    }
  }
};
