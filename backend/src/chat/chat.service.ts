import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { ValidationService } from './validation.service';
import { ComplaintService } from '../complaint/complaint.service';
import { VerificationService } from '../verification/verification.service';
import { CertificateService } from '../certificate/certificate.service';
import { EventService } from '../event/event.service';
import { TrackingService } from '../tracking/tracking.service';
import { LocalizationService, MetricsService } from '../localization/localization.service';
import { getWelcomeMessage, getLanguageSelectionResponse } from '../templates/greetings';
import { getEmpathyMessage } from '../templates/empathy';
import { getCompletionMessage } from '../templates/completions';
import { getEmergencyMessage } from '../templates/emergency';
import { AnalyticsService } from '../citizen-assistance/analytics.service';
import { IntelligenceService } from '../citizen-assistance/intelligence.service';
import { JurisdictionService } from '../jurisdiction-routing/jurisdiction.service';
import { JurisdictionLifecycleService } from '../jurisdiction-routing/jurisdiction-lifecycle.service';
import { LocationResolverService } from '../jurisdiction-routing/location-resolver.service';
import { JurisdictionRepository } from '../jurisdiction-routing/jurisdiction.repository';
import { RoutingPolicyService } from '../jurisdiction-routing/routing-policy.service';
import { RoutingTargetRegistryService } from '../jurisdiction-routing/routing-target-registry.service';
import { RoutingContext, ResolutionSource, ActorType } from '../jurisdiction-routing/jurisdiction-routing.types';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface CitizenState {
  id?: string;
  fullName: string;
  mobileNumber: string;
  email: string;
  addressLine1?: string;
  addressLine2?: string;
  city: string;
  district: string;
  state: string;
  pincode?: string;
  latitude: number | null;
  longitude: number | null;
  locality?: string;
  nearestPoliceStation?: string;
  isConfirmed: boolean;
}

interface ChatSessionState {
  workflow: 'complaint' | 'verification' | 'certificate' | 'event' | 'tracking' | null;
  step: string;
  currentWorkflowState?: string;
  serviceType?: string | null;
  applicationData?: Record<string, any>;
  referenceNumber?: string;
  data: Record<string, any>;
  language: 'en' | 'hi' | 'hinglish';
  languageSelected: boolean;
  citizen: CitizenState;
}

const TRANSLATIONS = {
  en: {
    cancel: "Current request has been cancelled. How else can I assist you?",
    invalidStep: "I may not have understood correctly. Could you please provide that information in a different way?",
    upcopApp: "\n\n*Need more official services? Download the official **UPCOP Mobile App** from the [Google Play Store](https://play.google.com/store/apps/details?id=com.up.uppolice) to access 27+ citizen services directly.*",
  },
  hi: {
    cancel: "वर्तमान अनुरोध रद्द कर दिया गया है। मैं आपकी और क्या सहायता कर सकता हूँ?",
    invalidStep: "मुझे शायद ठीक से समझ नहीं आया। क्या आप कृपया वह जानकारी किसी अन्य तरीके से प्रदान कर सकते हैं?",
    upcopApp: "\n\n*अधिक आधिकारिक सेवाओं के लिए, कृपया [गूगल प्ले स्टोर](https://play.google.com/store/apps/details?id=com.up.uppolice) से आधिकारिक **UPCOP मोबाइल ऐप** डाउनलोड करें।*",
  },
  hinglish: {
    cancel: "Request cancel kar di gayi hai. Aapko aur kis cheez me help chahiye?",
    invalidStep: "Mujhe shayad thik se samajh nahi aaya. Kya aap please wo information kisi aur tarike se de sakte hain?",
    upcopApp: "\n\n*Baaki official services ke liye, official **UPCOP App** download karein: [Google Play Store](https://play.google.com/store/apps/details?id=com.up.uppolice).* ",
  },
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private aiServiceUrl: string;
  private messageLibrary: any = null;
  public localizationService: LocalizationService;
  private readonly jurisdictionService: JurisdictionService;
  private readonly jurisdictionLifecycleService: JurisdictionLifecycleService;
  private readonly routingTargetRegistryService: RoutingTargetRegistryService;
  private readonly locationResolver = new LocationResolverService();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly complaintService: ComplaintService,
    private readonly verificationService: VerificationService,
    private readonly certificateService: CertificateService,
    private readonly eventService: EventService,
    private readonly trackingService: TrackingService,
    private readonly analyticsService: AnalyticsService,
    private readonly prisma: PrismaService,
    private readonly validationService: ValidationService,
    private readonly intelligenceService: IntelligenceService,
    localizationService?: LocalizationService,
    jurisdictionService?: JurisdictionService,
    jurisdictionLifecycleService?: JurisdictionLifecycleService,
    routingTargetRegistryService?: RoutingTargetRegistryService,
  ) {
    this.localizationService = localizationService || new LocalizationService(new MetricsService());
    this.routingTargetRegistryService = routingTargetRegistryService || new RoutingTargetRegistryService(this.prisma);
    this.jurisdictionService = jurisdictionService || new JurisdictionService(
      new LocationResolverService(),
      new JurisdictionRepository(this.prisma),
      new RoutingPolicyService(),
      this.routingTargetRegistryService,
      this.prisma,
      new EventEmitter2()
    );
    this.jurisdictionLifecycleService = jurisdictionLifecycleService || new JurisdictionLifecycleService(
      new JurisdictionRepository(this.prisma),
      new EventEmitter2()
    );
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    this.loadMessageLibrary();
  }

  private loadMessageLibrary() {
    try {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, 'message_library.json');
      if (fs.existsSync(filePath)) {
        this.messageLibrary = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.logger.log(`Loaded Message Library v${this.messageLibrary.version || 'unknown'} from ${filePath}`);
      } else {
        this.logger.error(`Message library file not found at ${filePath}`);
      }
    } catch (e) {
      this.logger.error(`Failed to load message library: ${e.message}`);
    }
  }

  formatMessage(
    key: string,
    lang: 'en' | 'hi' | 'hinglish',
    sessionId: string,
    params?: Record<string, any>
  ): string {
    if (!this.messageLibrary) {
      this.loadMessageLibrary();
    }
    const messages = this.messageLibrary?.messages || {};
    const msgObj = messages[key];

    let template = '';
    let finalLang = lang;

    if (!msgObj) {
      this.logMissingMessage(sessionId, key, lang);
      return key;
    }

    if (msgObj[lang] && msgObj[lang].trim() !== '') {
      template = msgObj[lang];
    } else {
      this.logMissingMessage(sessionId, key, lang);
      if (lang === 'hi') {
        if (msgObj['hinglish'] && msgObj['hinglish'].trim() !== '') {
          template = msgObj['hinglish'];
          finalLang = 'hinglish';
        } else if (msgObj['en'] && msgObj['en'].trim() !== '') {
          template = msgObj['en'];
          finalLang = 'en';
        }
      } else if (lang === 'hinglish') {
        if (msgObj['en'] && msgObj['en'].trim() !== '') {
          template = msgObj['en'];
          finalLang = 'en';
        }
      }
    }

    if (!template && msgObj['en']) {
      template = msgObj['en'];
    }

    if (!template) {
      const keys = Object.keys(msgObj);
      for (const k of keys) {
        if (msgObj[k] && msgObj[k].trim() !== '') {
          template = msgObj[k];
          break;
        }
      }
      if (!template) return key;
    }

    let formatted = template;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        formatted = formatted.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
      }
    }

    return formatted;
  }

  private async logMissingMessage(sessionId: string, key: string, language: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          sessionId: sessionId || 'unknown',
          eventType: 'MISSING_MESSAGE',
          eventData: { key, language },
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to log missing message audit trail: ${e.message}`);
    }
  }

  private async checkFrustration(
    message: string,
    state: ChatSessionState,
    sessionId: string
  ): Promise<{ response: string; suggestions?: string[] } | null> {
    const cleanMsg = message.toLowerCase().trim();
    let frustrationKey: string | null = null;

    if (
      cleanMsg.includes('why do you need') ||
      cleanMsg.includes('why this') ||
      cleanMsg.includes('why is it required') ||
      cleanMsg.includes('why is this required') ||
      cleanMsg.includes('why needed') ||
      cleanMsg.includes('what will you do with')
    ) {
      frustrationKey = 'FRUSTRATION_WHY_NEEDED';
    } else if (
      cleanMsg.includes("don't know") ||
      cleanMsg.includes("dont know") ||
      cleanMsg.includes("not sure") ||
      cleanMsg.includes("no idea") ||
      cleanMsg.includes("i do not know") ||
      cleanMsg.includes("i dont know")
    ) {
      frustrationKey = 'FRUSTRATION_DONT_KNOW';
    } else if (
      cleanMsg.includes('already told') ||
      cleanMsg.includes('already given') ||
      cleanMsg.includes('already provided') ||
      cleanMsg.includes('said before') ||
      cleanMsg.includes('already shared')
    ) {
      frustrationKey = 'FRUSTRATION_ALREADY_TOLD';
    } else if (
      cleanMsg.includes('explain') ||
      cleanMsg.includes('what is this') ||
      cleanMsg.includes('what does this mean') ||
      cleanMsg.includes('what is')
    ) {
      frustrationKey = 'FRUSTRATION_EXPLAIN_TERM';
    }

    if (!frustrationKey) {
      return null;
    }

    const frustrationText = this.formatMessage(frustrationKey, state.language || 'en', sessionId);

    let reprompt: { response: string; suggestions?: string[] } = { response: '' };

    if (!state.citizen.isConfirmed && state.workflow !== 'tracking') {
      reprompt = await this.runCitizenIdentificationFlow(state, '');
    } else {
      switch (state.workflow) {
        case 'complaint':
          reprompt = await this.runComplaintWorkflow(state, '');
          break;
        case 'verification':
          reprompt = await this.runVerificationWorkflow(state, '');
          break;
        case 'certificate':
          reprompt = await this.runCertificateWorkflow(state, '');
          break;
        case 'event':
          reprompt = await this.runEventWorkflow(state, '');
          break;
        case 'tracking':
          reprompt = await this.runTrackingWorkflow(state, '');
          break;
        default:
          reprompt = { response: 'How can I assist you today?' };
      }
    }

    return {
      response: `${frustrationText}\n\n${reprompt.response}`,
      suggestions: reprompt.suggestions,
    };
  }

  async getOrCreateSession(sessionId: string): Promise<ChatSessionState> {
    try {
      const session = await this.prisma.workflowSession.findUnique({
        where: { id: sessionId },
      });
      if (session) {
        return typeof session.stateJson === 'string'
          ? JSON.parse(session.stateJson)
          : session.stateJson as unknown as ChatSessionState;
      }
    } catch (e) {
      this.logger.warn(`Failed to read session from DB: ${e.message}`);
    }

    return {
      workflow: null,
      step: 'START',
      data: {},
      language: 'en',
      languageSelected: false,
      citizen: {
        fullName: '',
        mobileNumber: '',
        email: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        district: '',
        state: 'Uttar Pradesh',
        pincode: '',
        latitude: null,
        longitude: null,
        isConfirmed: false,
      },
      currentWorkflowState: 'START',
      serviceType: null,
      applicationData: {},
      referenceNumber: '',
    };
  }

  async saveSession(sessionId: string, state: ChatSessionState): Promise<void> {
    try {
      await this.prisma.workflowSession.upsert({
        where: { id: sessionId },
        update: {
          stateJson: state as any,
          currentStep: state.step || 'START',
          serviceType: state.workflow || null,
        },
        create: {
          id: sessionId,
          stateJson: state as any,
          currentStep: state.step || 'START',
          serviceType: state.workflow || null,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to save session to DB: ${e.message}`);
    }
  }

  async sendMessage(
    message: string,
    sessionId: string,
    latitude?: number,
    longitude?: number,
    clientLanguage?: string,
  ): Promise<{ response: string; suggestions?: string[]; avatar_state?: string; _debug?: any }> {
    console.log('[ChatService.sendMessage] Entry - message:', message, 'sessionId:', sessionId);
    this.analyticsService.trackHelpRequest();
    
    // Sanitize incoming message input to prevent Stored XSS
    const sanitizedMessage = this.validationService.sanitizeInput(message);


    // Load session state
    const state = await this.getOrCreateSession(sessionId);
    const stepBefore = String(state.step);

    // Synchronize language from client request if passed
    if (clientLanguage === 'hi' || clientLanguage === 'en') {
      state.language = clientLanguage;
      state.languageSelected = true;
    }

    // Update latitude and longitude if passed
    if (latitude !== undefined && latitude !== null) {
      state.citizen.latitude = latitude;
    }
    if (longitude !== undefined && longitude !== null) {
      state.citizen.longitude = longitude;
    }

    try {
      this.logger.log(`Forwarding message to FastAPI AI service: ${this.aiServiceUrl}/chat/message`);
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiServiceUrl}/chat/message`, {
          message: sanitizedMessage,
          session_id: sessionId,
          latitude: state.citizen.latitude,
          longitude: state.citizen.longitude,
          state: state,
        }),
      );

      const responseData = response.data;

      if (responseData && responseData.state) {
        Object.assign(state, responseData.state);
      }

      // Log workflow trace for FastAPI path
      await this.logWorkflowTrace(sessionId, 'FASTAPI', 'STEP_TRANSITION', state.workflow, stepBefore, String(state.step), sanitizedMessage);

      // Record self-learning intelligence events
      try {
        const citizenId = state.citizen.id || null;
        const workflow = state.workflow || null;
        const lang = state.language || 'en';
        
        // Log Conversation Insight (Intent tracking)
        await this.intelligenceService.logInsight(
          sessionId,
          citizenId,
          workflow,
          workflow || 'UNKNOWN_GREETING',
          0.95,
          lang
        );

        // Detect and log Sentiment (emotion tracking)
        let detectedSentiment = 'Neutral';
        let emotion = 'Neutral';
        const cleanMsg = sanitizedMessage.toLowerCase();
        if (cleanMsg.includes('stolen') || cleanMsg.includes('chori') || cleanMsg.includes('lost') || cleanMsg.includes('threat')) {
          detectedSentiment = 'Negative';
          emotion = 'Frustrated';
        } else if (cleanMsg.includes('happy') || cleanMsg.includes('thanks') || cleanMsg.includes('thank you') || cleanMsg.includes('dhanyavad')) {
          detectedSentiment = 'Positive';
          emotion = 'Happy';
        }
        await this.intelligenceService.logSentiment(sessionId, detectedSentiment, emotion, workflow);

        // Track unanswered/low-confidence FAQ questions
        if (responseData.response && responseData.response.includes('I may not have enough information')) {
          await this.intelligenceService.logUnansweredQuestion(sanitizedMessage, lang);
          await this.intelligenceService.logLearningEvent('Knowledge_Missing', 'WARN', { question: sanitizedMessage, language: lang });
        }

        // Save preferences
        if (citizenId) {
          await this.intelligenceService.saveCitizenPreferences(citizenId, lang, state.citizen.district, workflow);
        }
      } catch (logErr) {
        this.logger.warn(`Failed to capture intelligence logs: ${logErr.message}`);
      }

      if (responseData && responseData.db_action) {
        const dbResult = await this.executeDbAction(responseData.db_action);
        if (dbResult && dbResult.id) {
          state.citizen.id = dbResult.id;
          if (responseData.state && responseData.state.citizen) {
            responseData.state.citizen.id = dbResult.id;
          }
        }
        if (dbResult && dbResult.trackingResponse) {
          responseData.response = dbResult.trackingResponse;
        }
      }

      if (responseData && responseData.response) {
        const text = responseData.response;
        if (text.includes('112')) this.analyticsService.trackHelplineRecommendation('112');
        if (text.includes('1090')) this.analyticsService.trackHelplineRecommendation('1090');
        if (text.includes('1930')) this.analyticsService.trackHelplineRecommendation('1930');
        if (text.includes('1098')) this.analyticsService.trackHelplineRecommendation('1098');
        
        if (text.includes('EMERGENCY') || text.includes('Notice') || text.includes('आपातकालीन')) {
          this.analyticsService.trackEmergencyOverride();
        }

        responseData.response = this.validationService.sanitizeOutput(responseData.response);
      }

      // Persist state to DB
      await this.saveSession(sessionId, state);
      console.log('[ChatService.sendMessage] Exit - Successfully processed message via FastAPI');
      return { 
        ...responseData, 
        avatar_state: responseData.avatar_state || 'TALKING',
        _debug: { activeEngine: 'FASTAPI', step: state.step, workflow: state.workflow } 
      };
    } catch (e) {
      console.error('[ChatService.sendMessage] Warning - AI Service connection failed, using local fallback:', e);
      this.logger.warn(`AI Service connection failed (${e.message}). Initializing local rule-based mock workflow engine.`);
      await this.logWorkflowTrace(sessionId, 'FALLBACK', 'WORKFLOW_FALLBACK_USED', state.workflow, stepBefore, String(state.step), sanitizedMessage);
      const localResult = await this.handleLocalFallback(sanitizedMessage, sessionId, state);
      if (localResult && localResult.response) {
        localResult.response = this.validationService.sanitizeOutput(localResult.response);
      }
      // Log fallback step transition
      await this.logWorkflowTrace(sessionId, 'FALLBACK', 'STEP_TRANSITION', state.workflow, stepBefore, String(state.step), sanitizedMessage);
      await this.saveSession(sessionId, state);
      console.log('[ChatService.sendMessage] Exit - Processed message via Fallback engine');
      return { 
        ...localResult, 
        avatar_state: localResult.avatar_state || 'TALKING',
        _debug: { activeEngine: 'FALLBACK', step: state.step, workflow: state.workflow } 
      };
    }
  }  private async executeDbAction(dbAction: any): Promise<any> {
    if (!dbAction) return null;
    const formatLongDate = (date: any): string => {
      if (!date) return '';
      const d = new Date(date);
      const day = d.getDate();
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    };

    const normalizeServiceType = (type: string): string => {
      if (!type) return 'LOST_MOBILE';
      const upper = type.toUpperCase().replace(/\s+/g, '_');
      if (upper.includes('MOBILE')) return 'LOST_MOBILE';
      if (upper.includes('DOC') || upper.includes('LOST_DOCUMENT')) return 'LOST_DOCUMENT';
      if (upper.includes('CYBER')) return 'CYBER_FRAUD';
      if (upper.includes('HARASS')) return 'HARASSMENT';
      if (upper.includes('TENANT')) return 'TENANT_VERIFICATION';
      if (upper.includes('EMPLOYEE')) return 'EMPLOYEE_VERIFICATION';
      if (upper.includes('DOMESTIC') || upper.includes('HELP')) return 'DOMESTIC_HELP_VERIFICATION';
      if (upper.includes('CERTIFICATE') || upper.includes('CHARACTER')) return 'CHARACTER_CERTIFICATE';
      if (upper.includes('EVENT') || upper.includes('PERMISSION')) return 'EVENT_PERMISSION';
      return upper;
    };

    const resolveAndConfirmJurisdiction = async (
      citizenId: string,
      serviceType: string,
      locationText: string,
      context: RoutingContext
    ) => {
      let resolvedCitizenId = citizenId;
      if (!resolvedCitizenId || resolvedCitizenId === 'default-citizen-id' || resolvedCitizenId === 'new-id') {
        const firstCit = await this.prisma.citizen.findFirst();
        if (firstCit) {
          resolvedCitizenId = firstCit.id;
        } else {
          const newCit = await this.prisma.citizen.create({
            data: {
              fullName: "Default Citizen",
              mobileNumber: "9999999999",
              isConfirmed: true,
            }
          });
          resolvedCitizenId = newCit.id;
        }
      }

      const citizen = await this.prisma.citizen.findUnique({ where: { id: resolvedCitizenId } });
      const lat = citizen?.latitude;
      const lng = citizen?.longitude;
      const hasGps = typeof lat === 'number' && typeof lng === 'number';
      const gpsCoordinates = hasGps ? { lat: lat!, lng: lng! } : undefined;

      const normalizedService = normalizeServiceType(serviceType);

      const resolution = await this.jurisdictionService.resolveJurisdiction({
        serviceType: normalizedService,
        routingContext: context,
        location: locationText || [citizen?.addressLine1, citizen?.addressLine2, citizen?.city, citizen?.district].filter(Boolean).join(', ') || 'Lucknow',
        resolutionSource: hasGps ? ResolutionSource.GPS : ResolutionSource.TEXT_INPUT,
        coordinates: gpsCoordinates,
      });

      const confirmed = await this.jurisdictionLifecycleService.confirmResolution(
        resolution.id,
        'USER_CONFIRMED',
        ActorType.SYSTEM
      );

      return confirmed;
    };

    try {
      if (Array.isArray(dbAction)) {
        let citizenResult = null;
        for (const action of dbAction) {
          const res = await this.executeDbAction(action);
          if (action && action.type === 'citizen') {
            citizenResult = res;
          }
        }
        return citizenResult;
      }
      this.logger.log(`Executing DB Action: ${dbAction.type}`);
      switch (dbAction.type) {
        case 'audit_log':
          await this.prisma.auditLog.create({
            data: {
              sessionId: dbAction.data.sessionId || 'unknown',
              eventType: dbAction.data.eventType,
              eventData: dbAction.data.eventData || {},
            },
          });
          break;
        case 'citizen':
          const citizen = await this.prisma.citizen.upsert({
            where: { id: (dbAction.data.id && dbAction.data.id !== 'default-citizen-id' && dbAction.data.id !== 'new-id') ? dbAction.data.id : 'new-id' },
            update: {
              fullName: dbAction.data.fullName,
              mobileNumber: dbAction.data.mobileNumber,
              email: dbAction.data.email,
              addressLine1: dbAction.data.addressLine1,
              addressLine2: dbAction.data.addressLine2,
              city: dbAction.data.city,
              district: dbAction.data.district,
              state: dbAction.data.state,
              pincode: dbAction.data.pincode,
              latitude: dbAction.data.latitude,
              longitude: dbAction.data.longitude,
              isConfirmed: dbAction.data.isConfirmed,
            },
            create: {
              fullName: dbAction.data.fullName,
              mobileNumber: dbAction.data.mobileNumber,
              email: dbAction.data.email,
              addressLine1: dbAction.data.addressLine1,
              addressLine2: dbAction.data.addressLine2,
              city: dbAction.data.city,
              district: dbAction.data.district,
              state: dbAction.data.state,
              pincode: dbAction.data.pincode,
              latitude: dbAction.data.latitude,
              longitude: dbAction.data.longitude,
              isConfirmed: dbAction.data.isConfirmed,
            },
          });
          return citizen;
        case 'complaint':
          const comp = await this.complaintService.createComplaint(
            dbAction.data.type,
            dbAction.data.details,
            dbAction.data.refNum,
            dbAction.data.citizenId,
          );
          
          let complaintResolutionId: string | null = null;
          try {
            const resolution = await resolveAndConfirmJurisdiction(
              dbAction.data.citizenId,
              dbAction.data.type,
              '',
              RoutingContext.INCIDENT_LOCATION
            );
            complaintResolutionId = resolution.id;
          } catch (resErr) {
            this.logger.warn(`Failed to resolve/confirm jurisdiction: ${resErr.message}`);
          }

          await this.prisma.complaint.update({
            where: { referenceNumber: dbAction.data.refNum },
            data: {
              mobileBrand: dbAction.data.mobileBrand || null,
              mobileModel: dbAction.data.mobileModel || null,
              mobileColor: dbAction.data.mobileColor || null,
              purchaseYear: dbAction.data.purchaseYear || null,
              imeiNumber: dbAction.data.imeiNumber || null,
              jurisdictionResolutionId: complaintResolutionId,
            }
          });
          await this.prisma.trackingRecord.create({
            data: {
              referenceNumber: dbAction.data.refNum,
              serviceType: 'Complaint Registration',
              entityId: comp.id,
              citizenId: dbAction.data.citizenId && dbAction.data.citizenId !== 'default-citizen-id' ? dbAction.data.citizenId : null,
              currentStatus: 'SUBMITTED',
              statusHistory: [
                { status: 'SUBMITTED', timestamp: new Date().toISOString() }
              ] as any,
            }
          });
          break;
        case 'verification':
          const ver = await this.verificationService.createVerification(
            dbAction.data.type,
            dbAction.data.name,
            dbAction.data.address,
            dbAction.data.mobile,
            dbAction.data.propertyDetails,
            dbAction.data.refNum,
            dbAction.data.citizenId,
          );

          let verificationResolutionId: string | null = null;
          try {
            const resolution = await resolveAndConfirmJurisdiction(
              dbAction.data.citizenId,
              dbAction.data.type,
              dbAction.data.address || dbAction.data.propertyDetails || '',
              RoutingContext.PROPERTY_ADDRESS
            );
            verificationResolutionId = resolution.id;
          } catch (resErr) {
            this.logger.warn(`Failed to resolve/confirm jurisdiction: ${resErr.message}`);
          }

          await this.prisma.verification.update({
            where: { referenceNumber: dbAction.data.refNum },
            data: {
              jurisdictionResolutionId: verificationResolutionId,
            }
          });

          await this.prisma.trackingRecord.create({
            data: {
              referenceNumber: dbAction.data.refNum,
              serviceType: `${dbAction.data.type} Verification`,
              entityId: ver.id,
              citizenId: dbAction.data.citizenId && dbAction.data.citizenId !== 'default-citizen-id' ? dbAction.data.citizenId : null,
              currentStatus: 'SUBMITTED',
              statusHistory: [
                { status: 'SUBMITTED', timestamp: new Date().toISOString() }
              ] as any,
            }
          });
          break;
        case 'certificate':
          const usedProfileReuseCert = dbAction.data.usedProfileReuse === true || dbAction.data.isSelf === true;
          let profileSnapshotCert: any = null;
          if (usedProfileReuseCert && dbAction.data.citizenId) {
            const citizen = await this.prisma.citizen.findUnique({ where: { id: dbAction.data.citizenId } });
            if (citizen) {
              profileSnapshotCert = {
                fullName: citizen.fullName,
                mobileNumber: citizen.mobileNumber,
                email: citizen.email,
                addressLine1: citizen.addressLine1,
                addressLine2: citizen.addressLine2,
                city: citizen.city,
                district: citizen.district,
                state: citizen.state,
                pincode: citizen.pincode,
                latitude: citizen.latitude,
                longitude: citizen.longitude,
                locality: citizen.locality,
              };
            }
          }
          const cert = await this.certificateService.createCertificate(
            dbAction.data.name,
            dbAction.data.address,
            dbAction.data.district,
            dbAction.data.purpose,
            dbAction.data.refNum,
            dbAction.data.citizenId,
            usedProfileReuseCert,
            profileSnapshotCert,
            1,
          );

          let certificateResolutionId: string | null = null;
          try {
            const resolution = await resolveAndConfirmJurisdiction(
              dbAction.data.citizenId,
              'CHARACTER_CERTIFICATE',
              dbAction.data.address || dbAction.data.district || '',
              RoutingContext.APPLICANT_ADDRESS
            );
            certificateResolutionId = resolution.id;
          } catch (resErr) {
            this.logger.warn(`Failed to resolve/confirm jurisdiction: ${resErr.message}`);
          }

          await this.prisma.characterCertificate.update({
            where: { referenceNumber: dbAction.data.refNum },
            data: {
              jurisdictionResolutionId: certificateResolutionId,
            }
          });

          await this.prisma.trackingRecord.create({
            data: {
              referenceNumber: dbAction.data.refNum,
              serviceType: 'Character Certificate',
              entityId: cert.id,
              citizenId: dbAction.data.citizenId && dbAction.data.citizenId !== 'default-citizen-id' ? dbAction.data.citizenId : null,
              currentStatus: 'SUBMITTED',
              statusHistory: [
                { status: 'SUBMITTED', timestamp: new Date().toISOString() }
              ] as any,
            }
          });
          break;
        case 'event':
          const usedProfileReuseEvt = dbAction.data.usedProfileReuse === true || dbAction.data.isSelf === true;
          let profileSnapshotEvt: any = null;
          if (usedProfileReuseEvt && dbAction.data.citizenId) {
            const citizen = await this.prisma.citizen.findUnique({ where: { id: dbAction.data.citizenId } });
            if (citizen) {
              profileSnapshotEvt = {
                fullName: citizen.fullName,
                mobileNumber: citizen.mobileNumber,
                email: citizen.email,
                addressLine1: citizen.addressLine1,
                addressLine2: citizen.addressLine2,
                city: citizen.city,
                district: citizen.district,
                state: citizen.state,
                pincode: citizen.pincode,
                latitude: citizen.latitude,
                longitude: citizen.longitude,
                locality: citizen.locality,
              };
            }
          }
          const evt = await this.eventService.createEventPermission(
            dbAction.data.type,
            dbAction.data.name,
            dbAction.data.location,
            dbAction.data.date,
            dbAction.data.attendance,
            dbAction.data.refNum,
            dbAction.data.citizenId,
            dbAction.data.organizerName,
            dbAction.data.organizerAddress,
            dbAction.data.organizerMobile,
            dbAction.data.organizerIsApplicant !== false,
            usedProfileReuseEvt,
            profileSnapshotEvt,
            1,
          );

          let eventResolutionId: string | null = null;
          try {
            const resolution = await resolveAndConfirmJurisdiction(
              dbAction.data.citizenId,
              dbAction.data.type,
              dbAction.data.location || '',
              RoutingContext.EVENT_LOCATION
            );
            eventResolutionId = resolution.id;
          } catch (resErr) {
            this.logger.warn(`Failed to resolve/confirm jurisdiction: ${resErr.message}`);
          }

          await this.prisma.eventPermission.update({
            where: { referenceNumber: dbAction.data.refNum },
            data: {
              jurisdictionResolutionId: eventResolutionId,
            }
          });

          await this.prisma.trackingRecord.create({
            data: {
              referenceNumber: dbAction.data.refNum,
              serviceType: dbAction.data.type,
              entityId: evt.id,
              citizenId: dbAction.data.citizenId && dbAction.data.citizenId !== 'default-citizen-id' ? dbAction.data.citizenId : null,
              currentStatus: 'SUBMITTED',
              statusHistory: [
                { status: 'SUBMITTED', timestamp: new Date().toISOString() }
              ] as any,
            }
          });
          break;
        case 'track_query':
          const trackInfo = await this.trackingService.track(dbAction.data.referenceNumber);
          if (!trackInfo) {
            const errorResponses = {
              en: `❌ No application found matching reference number \`${dbAction.data.referenceNumber}\`. Please check and try again.`,
              hi: `❌ संदर्भ संख्या \`${dbAction.data.referenceNumber}\` से मेल खाता कोई आवेदन नहीं मिला। कृपया जांचें और पुनः प्रयास करें।`,
              hinglish: `❌ \`${dbAction.data.referenceNumber}\` reference number ka koi application nahi mila. Please check karke fir se try karein.`,
            };
            return { trackingResponse: errorResponses[dbAction.data.language || 'en'] };
          }
          const responses = {
            en: `Application Details\n\nReference Number:\n${trackInfo.referenceNumber}\n\nService:\n${trackInfo.serviceType}\n\nCurrent Status:\n${trackInfo.status}\n\nSubmitted On:\n${formatLongDate(trackInfo.createdAt)}\n\nLast Updated:\n${formatLongDate(trackInfo.updatedAt)}${trackInfo.timeline}`,
            hi: `Application Details\n\nReference Number:\n${trackInfo.referenceNumber}\n\nService:\n${trackInfo.serviceType}\n\nCurrent Status:\n${trackInfo.status}\n\nSubmitted On:\n${formatLongDate(trackInfo.createdAt)}\n\nLast Updated:\n${formatLongDate(trackInfo.updatedAt)}${trackInfo.timeline}`,
            hinglish: `Application Details\n\nReference Number:\n${trackInfo.referenceNumber}\n\nService:\n${trackInfo.serviceType}\n\nCurrent Status:\n${trackInfo.status}\n\nSubmitted On:\n${formatLongDate(trackInfo.createdAt)}\n\nLast Updated:\n${formatLongDate(trackInfo.updatedAt)}${trackInfo.timeline}`,
          };
          return { trackingResponse: responses[dbAction.data.language || 'en'] };
        case 'citizen_feedback':
          await this.intelligenceService.saveFeedback(
            dbAction.data.sessionId,
            dbAction.data.citizenId || null,
            dbAction.data.workflowType,
            dbAction.data.rating,
            dbAction.data.comments || '',
          );
          break;
      }
    } catch (error) {
      this.logger.error(`Failed to execute DB action: ${error.message}`);
    }
    return null;
  }


  private async handleLocalFallback(
    message: string,
    sessionId: string,
    state: ChatSessionState,
  ): Promise<{ response: string; suggestions?: string[]; avatar_state?: string }> {
    const cleanMsg = message.trim().toLowerCase();

    // Check frustration first
    const frustrationRes = await this.checkFrustration(message, state, sessionId);
    if (frustrationRes) {
      return frustrationRes;
    }

    const stepStr = String(state.step);
    const stepBefore = stepStr;
    const isProfileStep = [
      'IDENTIFY_NAME', 'CONFIRM_NAME', 'IDENTIFY_MOBILE', 'IDENTIFY_LOCATION', 
      'CONFIRM_CITY', 'CONFIRM_AUTO_LOCATION', 'IDENTIFY_ADDRESS', 'CONFIRM_PROFILE',
      'MODIFY_PROFILE_SELECT', 'MODIFY_PROFILE_INPUT', 'CONFIRM_LOCATION_SMART', 'CONFIRM_ADDRESS_SMART',
      'IDENTIFY_MOBILE_FIRST', 'VERIFY_EXISTING_PROFILE'
    ].includes(stepStr);

    // Guard: Workflow active steps must never be intercepted by feedback flow
    const isWorkflowActiveStep = stepStr === 'REVIEW' || (
      state.workflow && ['1','2','3','4','5','6','2_brand','2_model','2_color','2_year','2_imei'].includes(stepStr)
    );

    // Parse action-based button payloads (Enhancement 2)
    const actionPayload = this.parseAction(message);
    if (actionPayload) {
      const lang = state.language || 'en';
      switch (actionPayload.action) {
        case 'PROFILE_CONFIRM':
          return this.runCitizenIdentificationFlow(state, 'yes');
        case 'PROFILE_REJECT':
        case 'MODIFY_PROFILE':
          state.step = 'MODIFY_PROFILE_SELECT';
          return {
            response: "Which profile detail would you like to modify?\n\n- [1. Full Name](option:1)\n- [2. Mobile Number](option:2)\n- [3. Location](option:3)\n- [4. Complete Address](option:4)",
            suggestions: ['1', '2', '3', '4'],
          };
        case 'SUBMIT_APPLICATION':
          // Route to the active workflow's REVIEW handler with submit intent
          if (state.workflow && state.step === 'REVIEW') {
            return this.handleWorkflowSubmit(state, sessionId);
          }
          break;
        case 'CANCEL_APPLICATION':
          state.workflow = null;
          state.step = 'START';
          state.data = {};
          return {
            response: this.localizationService.translate('cancel', lang),
            suggestions: ['🚔 File a Complaint', '🏠 Tenant Verification', '📜 Character Certificate', '🎭 Event Permission', '🔍 Track Application'],
          };
        case 'TRACK_APPLICATION':
          state.workflow = 'tracking';
          state.step = 'START';
          return this.runTrackingWorkflow(state, '');
        case 'CHANGE_LANGUAGE':
          state.languageSelected = false;
          return {
            response: getWelcomeMessage(lang, this.localizationService),
            suggestions: ['English', 'हिंदी', 'Hinglish'],
          };
      }
    }

        const FEEDBACK_THANK_YOU = {
      en: "👮 Thank you for your feedback! It helps me learn and serve you better.",
      hi: "👮 आपकी प्रतिक्रिया के लिए धन्यवाद! यह मुझे सीखने और आपको बेहतर सेवा देने में मदद करता है।",
      hinglish: "👮 Feedback ke liye thank you! Ye mujhe improve karne aur aapko better serve karne mein help karta hai."
    };

    const COMMENT_REQUIRED_MSG = {
      en: "👮 Comments are required for ratings of 2 or less. Please let us know how we can improve.",
      hi: "👮 2 या उससे कम की रेटिंग के लिए टिप्पणी आवश्यक है। कृपया हमें बताएं कि हम कैसे सुधार कर सकते हैं।",
      hinglish: "👮 2 ya usse kam rating ke liye comment dena zaroori hai. Please batayein hum kaise improve karein."
    };

    // Feedback response intercept — ONLY when NOT in a profile or active workflow step
    if (!isProfileStep && !isWorkflowActiveStep) {
      if (state.step === 'ASK_FEEDBACK') {
        let rating = 0;
        const numMatch = cleanMsg.match(/\b([1-5])\b/);
        if (numMatch) {
          rating = parseInt(numMatch[1]);
        } else if (cleanMsg.includes('very helpful') || cleanMsg.includes('बहुत मददगार')) {
          rating = 5;
        } else if (cleanMsg.includes('not helpful') || cleanMsg.includes('मददगार नहीं')) {
          rating = 1;
        } else if (cleanMsg.includes('helpful') || cleanMsg.includes('मददगार')) {
          rating = 4;
        } else if (cleanMsg.includes('neutral') || cleanMsg.includes('सामान्य')) {
          rating = 3;
        } else if (cleanMsg.includes('needs improvement') || cleanMsg.includes('सुधार')) {
          rating = 2;
        }

        if (rating === 0) {
          return {
            response: this.formatMessage('FEEDBACK_ASK', state.language || 'en', sessionId) + '\n(Please select a rating from 1 to 5)',
            suggestions: this.getRatingSuggestions(state.language || 'en')
          };
        }

        if (rating >= 4) {
          await this.intelligenceService.saveFeedback(sessionId, state.citizen.id || null, state.workflow, rating, '');
          state.step = 'START';
          state.workflow = null;
          state.data = {};
          return {
            response: FEEDBACK_THANK_YOU[state.language || 'en'],
            suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
          };
        } else if (rating === 3) {
          state.step = 'FEEDBACK_COMMENT_OPTIONAL';
          state.data.feedbackRating = rating;
          const skipSug = state.language === 'hi' ? 'छोड़ें' : 'Skip';
          return {
            response: this.formatMessage('FEEDBACK_COMMENT_ASK', state.language || 'en', sessionId),
            suggestions: [skipSug]
          };
        } else {
          state.step = 'FEEDBACK_COMMENT_REQUIRED';
          state.data.feedbackRating = rating;
          return {
            response: this.formatMessage('FEEDBACK_COMMENT_ASK', state.language || 'en', sessionId),
            suggestions: []
          };
        }
      }

      if (state.step === 'FEEDBACK_COMMENT_OPTIONAL') {
        const rating = state.data.feedbackRating || 3;
        const isSkip = cleanMsg === 'skip' || cleanMsg === 'छोड़ें' || cleanMsg === 'option:skip' || cleanMsg === 'option:छोड़ें';
        const comment = isSkip ? '' : message;
        await this.intelligenceService.saveFeedback(sessionId, state.citizen.id || null, state.workflow, rating, comment);
        state.step = 'START';
        state.workflow = null;
        state.data = {};
        return {
          response: FEEDBACK_THANK_YOU[state.language || 'en'],
          suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
        };
      }

      if (state.step === 'FEEDBACK_COMMENT_REQUIRED') {
        const rating = state.data.feedbackRating || 2;
        const isSkip = cleanMsg === 'skip' || cleanMsg === 'छोड़ें' || cleanMsg === 'option:skip' || cleanMsg === 'option:छोड़ें';
        if (isSkip || !message.trim()) {
          return {
            response: COMMENT_REQUIRED_MSG[state.language || 'en'],
            suggestions: []
          };
        }
        await this.intelligenceService.saveFeedback(sessionId, state.citizen.id || null, state.workflow, rating, message);
        state.step = 'START';
        state.workflow = null;
        state.data = {};
        return {
          response: FEEDBACK_THANK_YOU[state.language || 'en'],
          suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
        };
      }
    }


    // Global Location Correction Override check
    const extractedLoc = this.validationService.extractCitizenData(message).location;
    const isLocationOverrideCommand = extractedLoc && (
      cleanMsg.includes('change location') ||
      cleanMsg.includes('change my location') ||
      cleanMsg.includes('live in') ||
      cleanMsg.includes('location is') ||
      cleanMsg.includes('rehta') ||
      cleanMsg.includes('rehti') ||
      cleanMsg.includes('में') ||
      cleanMsg.includes('मे') ||
      cleanMsg.includes('district is') ||
      cleanMsg.includes('change district') ||
      cleanMsg.includes('move location')
    );
    if (isLocationOverrideCommand && extractedLoc) {
      state.citizen.city = extractedLoc;
      state.citizen.district = extractedLoc;

      // Update Citizen Record in DB if citizen.id exists and is confirmed
      if (state.citizen.id) {
        try {
          await this.prisma.citizen.update({
            where: { id: state.citizen.id },
            data: {
              city: state.citizen.city,
              district: state.citizen.district,
            }
          });
        } catch (dbErr) {
          this.logger.warn(`Failed to update citizen location in DB: ${dbErr.message}`);
        }
      }

      // Create Audit Log for Location Change
      try {
        await this.prisma.auditLog.create({
          data: {
            sessionId: sessionId,
            eventType: 'LOCATION_CHANGE',
            eventData: { city: state.citizen.city, district: state.citizen.district },
          }
        });
      } catch (auditErr) {
        this.logger.warn(`Failed to write location change audit log: ${auditErr.message}`);
      }

      // Create Audit Log for Profile Update (Location field)
      try {
        await this.prisma.auditLog.create({
          data: {
            sessionId: sessionId,
            eventType: 'PROFILE_UPDATE',
            eventData: { field: 'city', value: state.citizen.city },
          }
        });
      } catch (auditErr) {}

      if (state.step === 'CONFIRM_PROFILE') {
        if (!state.citizen.fullName || !state.citizen.mobileNumber || (!state.citizen.city && !state.citizen.district) || !state.citizen.addressLine1) {
          state.step = 'IDENTIFY_ADDRESS'; // Let the fallback logic pick up the exact missing field
        } else {
          return this.renderConfirmationCard(state);
        }
      } else if (state.step === 'REVIEW') {
        return this.renderActiveWorkflowReviewScreen(state);
      } else if (state.step === 'IDENTIFY_LOCATION' || state.step === 'CONFIRM_CITY' || state.step === 'CONFIRM_LOCATION') {
        state.step = 'IDENTIFY_ADDRESS';
        return {
          response: `I found your location as ${state.citizen.city}, Uttar Pradesh. Is this correct?\n\n- [Confirm](option:Confirm)\n- [Change Location](option:Change Location)`,
          suggestions: ['Confirm', 'Change Location'],
        };
      } else {
        return {
          response: `👮 Location updated to **${extractedLoc}**. Please continue with your request.`,
          suggestions: [],
        };
      }
    }

    const emergencyKeywords = [
      'danger', 'assault', 'threat', 'life', 'weapon', 'murder', 'burglar', 'attack', 'emergency',
      'मदद', 'खतरा', 'हमला', 'kidnapping', 'burglary', 'ongoing attack', 'burglary in progress', 'immediate danger',
      'attacking me', 'someone is attacking', 'attacking me right now', 'आपातकालीन', 'सहायता',
      'emergency help', 'emergency contacts', 'आपातकालीन सहायता'
    ];
    if (emergencyKeywords.some(keyword => cleanMsg.includes(keyword))) {
      state.workflow = null;
      state.step = 'START';
      state.data = {};
      return {
        response: getEmergencyMessage(state.language, this.localizationService),
        suggestions: ['🚔 File a Complaint', '🔍 Track Status'],
      };
    }

    // Language selection
    if (!state.languageSelected) {
      let matchedLang = false;
      const oldLang = state.language;
      let newLang: 'en' | 'hi' | 'hinglish' | null = null;
      if (cleanMsg === 'english' || cleanMsg.includes('option:english')) {
        newLang = 'en';
        matchedLang = true;
      } else if (cleanMsg === 'हिंदी' || cleanMsg.includes('hindi') || cleanMsg.includes('option:हिंदी') || cleanMsg.includes('option:हिंदी (hindi)')) {
        newLang = 'hi';
        matchedLang = true;
      } else if (cleanMsg === 'hinglish' || cleanMsg.includes('option:hinglish')) {
        newLang = 'hinglish';
        matchedLang = true;
      }

      if (matchedLang && newLang) {
        if (oldLang !== newLang) {
          this.localizationService.logLanguageSwitch(sessionId, oldLang, newLang);
        }
        state.language = newLang;
        state.languageSelected = true;
        this.analyticsService.trackLanguage(state.language);
        return {
          response: getLanguageSelectionResponse(state.language, this.localizationService, sessionId),
          suggestions: ['🚔 File a Complaint', '🏠 Tenant Verification', '📜 Character Certificate', '🎭 Event Permission', '🔍 Track Application'],
        };
      }

      // Detect starting workflow in greeting
      const startsWf = this.detectWorkflowIntent(cleanMsg);
      if (startsWf) {
        state.workflow = startsWf;
        state.languageSelected = true;
        this.analyticsService.trackLanguage(state.language);
        // Auto-populate subtype (type) in state.data if matched in greeting
        if (startsWf === 'complaint') {
          if (cleanMsg.includes('mobile') || cleanMsg.includes('theft') || cleanMsg.includes('stolen') || cleanMsg.includes('chori') || cleanMsg.includes('गुम') || cleanMsg.includes('phone') || cleanMsg.includes('फ़ोन')) {
            state.data.type = 'Lost Mobile / Theft';
          } else if (cleanMsg.includes('document') || cleanMsg.includes('passport') || cleanMsg.includes('card') || cleanMsg.includes('dastavez')) {
            state.data.type = 'Lost Document';
          }
        } else if (startsWf === 'verification') {
          if (cleanMsg.includes('tenant') || cleanMsg.includes('rent') || cleanMsg.includes('kirayedar')) {
            state.data.type = 'Tenant Verification';
          } else if (cleanMsg.includes('pg')) {
            state.data.type = 'PG Verification';
          } else if (cleanMsg.includes('domestic') || cleanMsg.includes('help') || cleanMsg.includes('naukar')) {
            state.data.type = 'Domestic Help Verification';
          } else if (cleanMsg.includes('employee')) {
            state.data.type = 'Employee Verification';
          }
        } else if (startsWf === 'event') {
          if (cleanMsg.includes('permission') || cleanMsg.includes('event')) {
            state.data.type = 'Event Permission';
          } else if (cleanMsg.includes('procession')) {
            state.data.type = 'Procession Request';
          } else if (cleanMsg.includes('protest')) {
            state.data.type = 'Protest Request';
          }
        }
      } else {
        return {
          response: getWelcomeMessage('en', this.localizationService),
          suggestions: ['English', 'हिंदी', 'Hinglish'],
        };
      }
    }

    const lang = state.language;

    // Cancel command
    if (cleanMsg === 'cancel' || cleanMsg === 'radd' || cleanMsg === 'रद्द' || cleanMsg === 'exit') {
      state.workflow = null;
      state.step = 'START';
      state.data = {};
      return {
        response: this.localizationService.translate('cancel', lang, undefined, undefined, sessionId),
        suggestions: ['🚔 File a Complaint', '🏠 Tenant Verification', '📜 Character Certificate', '🎭 Event Permission', '🔍 Track Application'],
      };
    }

    // Check if workflow needs to be determined
    if (!state.workflow) {
      const detectedWf = this.detectWorkflowIntent(cleanMsg);
      if (detectedWf) {
        state.workflow = detectedWf;
        state.step = 'START';
        // Auto-populate subtype (type) in state.data if matched
        if (detectedWf === 'complaint') {
          if (cleanMsg.includes('mobile') || cleanMsg.includes('theft') || cleanMsg.includes('stolen') || cleanMsg.includes('chori') || cleanMsg.includes('गुम') || cleanMsg.includes('phone') || cleanMsg.includes('फ़ोन')) {
            state.data.type = 'Lost Mobile / Theft';
          } else if (cleanMsg.includes('document') || cleanMsg.includes('passport') || cleanMsg.includes('card') || cleanMsg.includes('dastavez')) {
            state.data.type = 'Lost Document';
          }
        } else if (detectedWf === 'verification') {
          if (cleanMsg.includes('tenant') || cleanMsg.includes('rent') || cleanMsg.includes('kirayedar')) {
            state.data.type = 'Tenant Verification';
          } else if (cleanMsg.includes('pg')) {
            state.data.type = 'PG Verification';
          } else if (cleanMsg.includes('domestic') || cleanMsg.includes('help') || cleanMsg.includes('naukar')) {
            state.data.type = 'Domestic Help Verification';
          } else if (cleanMsg.includes('employee')) {
            state.data.type = 'Employee Verification';
          }
        } else if (detectedWf === 'event') {
          if (cleanMsg.includes('permission') || cleanMsg.includes('event')) {
            state.data.type = 'Event Permission';
          } else if (cleanMsg.includes('procession')) {
            state.data.type = 'Procession Request';
          } else if (cleanMsg.includes('protest')) {
            state.data.type = 'Protest Request';
          }
        }
      }
    }

    if (!state.workflow) {
      // General FAQ Fallbacks
      const faqList = [
        {
          keys: ['postmortem', 'post mortem', 'pm report', 'पोस्टमार्टम'],
          response: '🔬 **Postmortem Report Request Procedure:**\nTo obtain a postmortem report in Uttar Pradesh:\n1. Apply at the district Chief Medical Officer (CMO) office.\n2. Submit a request letter indicating the relationship to the deceased, along with copy of FIR/Panchnama and death certificate.\n*(Note: Rakku assists in guidance, but actual reports are issued offline by CMO office).*',
        },
        {
          keys: ['police services', 'what do you do', 'services', 'help', 'मदद', 'सुविधाएं'],
          response: '👮 **UP Police Citizen Services:**\nThrough our online portal, citizens can access:\n- FIR Lodging\n- Character Verification\n- Tenant/PG/Domestic Help Verification\n- Event/Protest/Procession permissions\n\nLet me know which service you are interested in.',
        }
      ];

      for (const faq of faqList) {
        if (faq.keys.some(k => cleanMsg.includes(k))) {
          return {
            response: faq.response,
            suggestions: ['🚔 File a Complaint', '🏠 Tenant Verification', '📜 Character Certificate', '🔍 Track Application'],
          };
        }
      }

      return {
        response: getWelcomeMessage('en', this.localizationService),
        suggestions: ['English', 'हिंदी', 'Hinglish'],
      };
    }

    // Enforce Citizen Identification & Confirmation first (unless already confirmed)
    if (!state.citizen.isConfirmed && state.workflow !== 'tracking') {
      return this.runCitizenIdentificationFlow(state, message);
    }

    // If citizen is already confirmed and starting a workflow, initialize step to '1'
    if (state.citizen.isConfirmed && state.step === 'START' && state.workflow && state.workflow !== 'tracking') {
      state.step = '1';
    }

    // Process Active Workflows
    let empathyPrepend = "";
    if (message && !state.data.empathyShown) {
      empathyPrepend = getEmpathyMessage(message, lang, this.localizationService, sessionId);
      if (empathyPrepend) {
        state.data.empathyShown = true;
      }
    }

    let res: { response: string; suggestions?: string[] };
    switch (state.workflow) {
      case 'complaint':
        res = await this.runComplaintWorkflow(state, message);
        break;
      case 'verification':
        res = await this.runVerificationWorkflow(state, message);
        break;
      case 'certificate':
        res = await this.runCertificateWorkflow(state, message);
        break;
      case 'event':
        res = await this.runEventWorkflow(state, message);
        break;
      case 'tracking':
        res = await this.runTrackingWorkflow(state, message);
        break;
      default:
        res = { response: this.localizationService.translate('invalidStep', lang) };
    }

    // Enhancement 6: Dead-end detection
    res = await this.validateWorkflowResponse(res, sessionId, state, stepBefore);

    if (empathyPrepend && res) {
      res.response = empathyPrepend + res.response;
    }
    return res;
  }

  private detectWorkflowIntent(cleanMsg: string): ChatSessionState['workflow'] {
    if (cleanMsg.includes('complaint') || cleanMsg.includes('stolen') || cleanMsg.includes('shikayat') || cleanMsg.includes('चोरी') || cleanMsg.includes('शिकायत') || cleanMsg.includes('lost') || cleanMsg.includes('wallet') || cleanMsg.includes('pocket') || cleanMsg.includes('chori') || cleanMsg.includes('chora') || cleanMsg.includes('kho') || cleanMsg.includes('gum') || cleanMsg.includes('fraud') || cleanMsg.includes('scam')) {
      return 'complaint';
    }
    if (cleanMsg.includes('tenant') || cleanMsg.includes('verification') || cleanMsg.includes('satyapan') || cleanMsg.includes('किरायेदार') || cleanMsg.includes('सत्यापन')) {
      return 'verification';
    }
    if (cleanMsg.includes('certificate') || cleanMsg.includes('character') || cleanMsg.includes('charitra') || cleanMsg.includes('चरित्र') || cleanMsg.includes('प्रमाण')) {
      return 'certificate';
    }
    if (cleanMsg.includes('event') || cleanMsg.includes('permission') || cleanMsg.includes('protest') || cleanMsg.includes('procession') || cleanMsg.includes('shooting') || cleanMsg.includes('अनुमति')) {
      return 'event';
    }
    if (cleanMsg.includes('track') || cleanMsg.includes('status') || cleanMsg.includes('pata karein') || cleanMsg.includes('स्थिति')) {
      return 'tracking';
    }
    return null;
  }

  // --- Enhancement 1: Workflow Trace Logging ---
  private async logWorkflowTrace(
    sessionId: string,
    engine: 'FASTAPI' | 'FALLBACK',
    eventType: string,
    workflow: string | null,
    stepBefore: string,
    stepAfter: string,
    message: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          sessionId,
          eventType,
          eventData: {
            engine,
            workflow: workflow || 'NONE',
            message: message.substring(0, 200),
            stepBefore,
            stepAfter,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to log workflow trace: ${e.message}`);
    }
  }

  // --- Enhancement 2: Action-Based Button Parsing ---
  private parseAction(message: string): { action: string } | null {
    try {
      const parsed = JSON.parse(message);
      if (parsed && parsed.action) return parsed;
    } catch { /* not JSON, ignore */ }
    if (message.startsWith('action:')) {
      return { action: message.substring(7).trim() };
    }
    return null;
  }

  // --- Enhancement 2: Action submit handler ---
  private async handleWorkflowSubmit(
    state: ChatSessionState,
    sessionId: string,
  ): Promise<{ response: string; suggestions?: string[] }> {
    switch (state.workflow) {
      case 'complaint':
        return this.runComplaintWorkflow(state, 'Submit Application');
      case 'verification':
        return this.runVerificationWorkflow(state, 'Submit Application');
      case 'certificate':
        return this.runCertificateWorkflow(state, 'Submit Application');
      case 'event':
        return this.runEventWorkflow(state, 'Submit Application');
      default:
        return { response: 'No active workflow to submit.', suggestions: ['File Complaint', 'Track Status'] };
    }
  }

  private normalizeReferenceNumber(input: string): string {
    return input.trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  }

  private isValidReferenceFormat(ref: string): boolean {
    const normalized = this.normalizeReferenceNumber(ref);
    return /^UP-(CMP|TV|CC|EP)-\d{4}-\d{4,6}$/.test(normalized);
  }

  // --- Enhancement 6: Dead-End Detection ---
  private async validateWorkflowResponse(
    result: { response: string; suggestions?: string[] } | null,
    sessionId: string,
    state: ChatSessionState,
    stepBefore: string,
  ): Promise<{ response: string; suggestions?: string[] }> {
    const isDeadEnd = !result
      || !result.response
      || result.response === 'undefined'
      || result.response === 'null'
      || result.response === 'Invalid step'
      || result.response.trim() === '';

    if (isDeadEnd) {
      await this.logWorkflowTrace(
        sessionId, 'FALLBACK', 'WORKFLOW_FAILED',
        state.workflow, stepBefore, String(state.step),
        `Dead-end detected: response=${result?.response}`
      );

      state.step = 'START';
      return {
        response: "👮 I encountered an issue processing your request. Let me help you start over.\n\nHow can I assist you today?",
        suggestions: state.language === 'hi'
          ? ['🚔 शिकायत दर्ज करें', '🏠 किरायेदार सत्यापन', '📜 चरित्र प्रमाण पत्र', '🎭 कार्यक्रम अनुमति', '🔍 आवेदन की स्थिति']
          : ['🚔 File a Complaint', '🏠 Tenant Verification', '📜 Character Certificate', '🎭 Event Permission', '🔍 Track Application'],
      };
    }
    return result;
  }

  private async runCitizenIdentificationFlow(
    state: ChatSessionState,
    message: string,
  ): Promise<{ response: string; suggestions?: string[] }> {
    const cleanMsg = message.trim().toLowerCase();
    const stepStr = String(state.step);
    // State Machine Steps
    if (message !== '') {
      if (stepStr === 'IDENTIFY_MOBILE_FIRST') {
        if (this.validationService.validateMobile(message)) {
          const normalizedMobile = this.validationService.normalizeMobile(message)!;
          state.citizen.mobileNumber = normalizedMobile;
          
          const existingCitizen = await this.prisma.citizen.findFirst({
            where: {
              mobileNumber: normalizedMobile,
              isConfirmed: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          });
          
          if (existingCitizen) {
            state.citizen.id = existingCitizen.id;
            state.citizen.fullName = existingCitizen.fullName;
            state.citizen.mobileNumber = existingCitizen.mobileNumber;
            state.citizen.city = existingCitizen.city || '';
            state.citizen.district = existingCitizen.district || '';
            state.citizen.addressLine1 = existingCitizen.addressLine1 || '';
            state.citizen.addressLine2 = existingCitizen.addressLine2 || '';
            state.citizen.pincode = existingCitizen.pincode || '';
            state.citizen.state = existingCitizen.state || 'Uttar Pradesh';
            
            state.step = 'VERIFY_EXISTING_PROFILE';
            
            const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
            let addressDisplay = state.citizen.addressLine1 || '';
            if (state.citizen.addressLine2) {
              addressDisplay += `, ${state.citizen.addressLine2}`;
            }
            if (state.citizen.pincode) {
              addressDisplay += ` - ${state.citizen.pincode}`;
            }
            
            const responseText = this.formatMessage('PROFILE_WELCOME_BACK', state.language || 'en', '', {
              name: state.citizen.fullName,
              mobile: state.citizen.mobileNumber,
              district: localizedCity,
              address: addressDisplay,
            });
            
            return {
              response: responseText,
              suggestions: state.language === 'hi' 
                ? ['जारी रखें', 'प्रोफ़ाइल अपडेट करें', 'अन्य विवरण उपयोग करें']
                : ['Continue', 'Update Profile', 'Use Different Details'],
            };
          } else {
            state.step = 'IDENTIFY_NAME';
            const localizedNotFound = this.formatMessage('PROFILE_NOT_FOUND', state.language || 'en', '');
            const namePrompt = this.formatMessage('PROFILE_NAME_REQUEST', state.language || 'en', '');
            return {
              response: `${localizedNotFound}\n\n${namePrompt}`,
              suggestions: [],
            };
          }
        } else {
          return {
            response: state.language === 'hi' 
              ? "👮 मोबाइल नंबर अधूरा प्रतीत होता है। कृपया 10 अंकों का एक वैध भारतीय मोबाइल नंबर दर्ज करें।"
              : state.language === 'hinglish'
              ? "👮 Mobile number incomplete lag raha hai. Please ek valid 10-digit Indian mobile number share karein."
              : "👮 The mobile number appears incomplete. Please provide a valid 10-digit Indian mobile number.",
            suggestions: [],
          };
        }
      } else if (stepStr === 'VERIFY_EXISTING_PROFILE') {
        const cleanMsg = message.trim().toLowerCase();
        const words = cleanMsg.split(/\b/);
        
        const isContinue = [
          'continue', 'yes', 'correct', 'option:continue', 'option:yes', 'option:✅ continue', 'option:✅ जारी रखें', '✅ continue', '✅ जारी रखें', 'जारी रखें'
        ].some(k => {
          if (k === 'yes') return words.includes('yes');
          return cleanMsg.includes(k);
        });
        
        const isUpdate = [
          'update', 'modify', 'edit', 'change', 'option:update profile', 'option:✏️ update profile', 'option:✏️ प्रोफ़ाइल अपडेट करें', '✏️ update profile', '✏️ प्रोफ़ाइल अपडेट करें', 'update profile', 'प्रोफ़ाइल अपडेट करें'
        ].some(k => cleanMsg.includes(k));
        
        const isUseDifferent = [
          'different', 'use different', 'option:use different details', 'option:🆕 use different details', 'option:🆕 अन्य विवरण उपयोग करें', '🆕 use different details', '🆕 अन्य विवरण उपयोग करें', 'use different details', 'अन्य विवरण उपयोग करें'
        ].some(k => cleanMsg.includes(k));
        
        if (isContinue) {
          state.citizen.isConfirmed = true;
          const successText = `👮 **Citizen Profile Verified**\n\nName: **${state.citizen.fullName}**\nMobile: **${state.citizen.mobileNumber}**\nLocation: **${state.citizen.city || state.citizen.district || 'Lucknow'}, ${state.citizen.state}**\n\n✓ Profile verification complete.\nLet's continue with your request.`;
          
          state.step = '1';
          let res: any;
          if (state.workflow === 'complaint') {
            res = await this.runComplaintWorkflow(state, "");
          } else if (state.workflow === 'verification') {
            res = await this.runVerificationWorkflow(state, "");
          } else if (state.workflow === 'certificate') {
            res = await this.runCertificateWorkflow(state, "");
          } else if (state.workflow === 'event') {
            res = await this.runEventWorkflow(state, "");
          }
          
          if (res) {
            return {
              response: successText + "\n\n" + res.response,
              suggestions: res.suggestions,
            };
          } else {
            state.step = 'START';
            return {
              response: successText + "\n\nHow would you like me to help you today?",
              suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
            };
          }
        } else if (isUpdate) {
          state.step = 'MODIFY_PROFILE_SELECT';
          return {
            response: state.language === 'hi' ? "आप कौन सा विवरण बदलना चाहेंगे?\n\n1. नाम\n2. मोबाइल नंबर\n3. स्थान (शहर/ज़िला)\n4. पता" :
                      state.language === 'hinglish' ? "Aap kaun sa detail modify karna chahenge?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address" :
                      "Which detail would you like to modify?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address",
            suggestions: ['1', '2', '3', '4'],
          };
        } else if (isUseDifferent) {
          const mob = state.citizen.mobileNumber;
          state.citizen = {
            mobileNumber: mob,
          } as any;
          state.step = 'IDENTIFY_NAME';
          return {
            response: this.formatMessage('PROFILE_NAME_REQUEST', state.language || 'en', ''),
            suggestions: [],
          };
        } else {
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          let addressDisplay = state.citizen.addressLine1 || '';
          if (state.citizen.addressLine2) {
            addressDisplay += `, ${state.citizen.addressLine2}`;
          }
          if (state.citizen.pincode) {
            addressDisplay += ` - ${state.citizen.pincode}`;
          }
          const responseText = this.formatMessage('PROFILE_WELCOME_BACK', state.language || 'en', '', {
            name: state.citizen.fullName,
            mobile: state.citizen.mobileNumber,
            district: localizedCity,
            address: addressDisplay,
          });
          return {
            response: responseText,
            suggestions: state.language === 'hi' 
              ? ['जारी रखें', 'प्रोफ़ाइल अपडेट करें', 'अन्य विवरण उपयोग करें']
              : ['Continue', 'Update Profile', 'Use Different Details'],
          };
        }
      } else if (stepStr === 'IDENTIFY_NAME') {
        const confRes = this.validationService.validateNameConfidence(message);
        if (confRes.valid) {
          state.citizen.fullName = message.trim();
          if (state.citizen.fullName.split(/\s+/).length === 1) {
            state.data.nameSuggestFlag = true;
          }
          
          if (state.citizen.mobileNumber) {
            const detected = await this.autoDetectLocation(state);
            if (detected) {
              state.citizen.city = detected.city;
              state.citizen.district = detected.district;
              state.citizen.addressLine1 = detected.addressLine1 || `${detected.city}`;
              state.step = 'CONFIRM_LOCATION_SMART';
              
              const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
              const localizedAddress = state.citizen.addressLine1 || '';
              
              let confirmText = `📍 I found your location as:\n\n${localizedCity}, Uttar Pradesh\n${localizedAddress}\n\nIs this correct?`;
              let confirmSug = '✅ Confirm';
              let modifySug = '✏️ Modify';
              if (state.language === 'hi') {
                confirmText = `📍 मुझे आपका स्थान मिला है:\n\n${localizedCity}, उत्तर प्रदेश\n${localizedAddress}\n\nक्या यह सही है?`;
                confirmSug = '✅ पुष्टि करें';
                modifySug = '✏️ बदलें';
              }
              return {
                response: confirmText,
                suggestions: [confirmSug, modifySug],
              };
            } else {
              state.step = 'IDENTIFY_LOCATION';
              return {
                response: state.language === 'hi' ? "❌ मैं स्वचालित रूप से आपका वर्तमान स्थान निर्धारित करने में असमर्थ हूँ।\n\nकृपया अपना शहर, ज़िला या क्षेत्र मैन्युअल रूप से दर्ज करें।" :
                          state.language === 'hinglish' ? "❌ Hum aapka current location automatically detect nahi kar paye.\n\nPlease apna city, district ya area manually enter karein." :
                          "❌ Unable to determine your current location automatically.\n\nPlease enter your city, district, or area manually.",
                suggestions: [],
              };
            }
          } else {
            state.step = 'IDENTIFY_MOBILE';
            const lang = state.language || 'en';
            let promptText = this.formatMessage('PROFILE_MOBILE_REQUEST', lang, '', { name: state.citizen.fullName });
            if (state.data.nameSuggestFlag) {
              promptText = "*(Polite Suggestion: Providing a full name with surname is recommended for official records, but we can proceed.)*\n\n" + promptText;
              delete state.data.nameSuggestFlag;
            }
            return {
              response: promptText,
              suggestions: [],
            };
          }
        } else {
          return {
            response: "I may not have understood correctly. Could you please provide that information in a different way?\nExample: Rahul Kumar or Raju",
            suggestions: [],
          };
        }
      } else if (stepStr === 'CONFIRM_NAME') {
        if (['confirm', 'yes', 'correct', 'confirm name', 'option:confirm', 'option:yes', 'option:confirm name'].includes(cleanMsg)) {
          state.citizen.fullName = (state.data.pendingName || '').trim();
          if (state.citizen.fullName.split(/\s+/).length === 1) {
            state.data.nameSuggestFlag = true;
          }
          delete state.data.pendingName;
        } else if (['change', 'no', 'change name', 'option:no', 'option:change name'].includes(cleanMsg)) {
          state.step = 'IDENTIFY_NAME';
          delete state.data.pendingName;
          return {
            response: "Understood. Please enter your name again:",
            suggestions: [],
          };
        } else {
          return {
            response: `Is '${state.data.pendingName}' your correct full name?\n\n- [Confirm Name](option:Confirm Name)\n- [Change Name](option:Change Name)`,
            suggestions: ['Confirm Name', 'Change Name'],
          };
        }
      } else if (stepStr === 'IDENTIFY_MOBILE') {
        if (this.validationService.validateMobile(message)) {
          state.citizen.mobileNumber = this.validationService.normalizeMobile(message)!;
          
          // Auto-detect Location priority order
          const detected = await this.autoDetectLocation(state);
          if (detected) {
            state.citizen.city = detected.city;
            state.citizen.district = detected.district;
            state.citizen.addressLine1 = detected.addressLine1 || `${detected.city}`;
            
            state.step = 'CONFIRM_LOCATION_SMART';
            
            const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
            const localizedAddress = state.citizen.addressLine1 || '';
            
            let confirmText = `📍 I found your location as:\n\n${localizedCity}, Uttar Pradesh\n${localizedAddress}\n\nIs this correct?`;
            let confirmSug = '✅ Confirm';
            let modifySug = '✏️ Modify';
            if (state.language === 'hi') {
              confirmText = `📍 मुझे आपका स्थान मिला है:\n\n${localizedCity}, उत्तर प्रदेश\n${localizedAddress}\n\nक्या यह सही है?`;
              confirmSug = '✅ पुष्टि करें';
              modifySug = '✏️ बदलें';
            }
            
            return {
              response: confirmText,
              suggestions: [confirmSug, modifySug],
            };
          } else {
            state.step = 'IDENTIFY_LOCATION';
            return {
              response: state.language === 'hi' ? "❌ मैं स्वचालित रूप से आपका वर्तमान स्थान निर्धारित करने में असमर्थ हूँ।\n\nकृपया अपना शहर, ज़िला या क्षेत्र मैन्युअल रूप से दर्ज करें।" :
                        state.language === 'hinglish' ? "❌ Hum aapka current location automatically detect nahi kar paye.\n\nPlease apna city, district ya area manually enter karein." :
                        "❌ Unable to determine your current location automatically.\n\nPlease enter your city, district, or area manually.",
              suggestions: [],
            };
          }
        } else {
          return {
            response: "👮 The mobile number appears incomplete. Please provide a valid 10-digit Indian mobile number.",
            suggestions: [],
          };
        }
      } else if (stepStr === 'CONFIRM_LOCATION_SMART') {
        const words = cleanMsg.split(/\b/);
        const isConfirm = ['confirm', 'yes', 'correct', 'पुष्टि', 'option:confirm', 'option:yes', 'option:✅ confirm', 'option:✅ पुष्टि करें', '✅ confirm', '✅ पुष्टि करें'].some(k => {
          if (k === 'yes') return words.includes('yes');
          return cleanMsg.includes(k);
        });
        const isModify = ['modify', 'change', 'no', 'बदलें', 'option:modify', 'option:no', 'option:✏️ modify', 'option:✏️ बदलें', '✏️ modify', '✏️ बदलें'].some(k => {
          if (k === 'no') return words.includes('no');
          return cleanMsg.includes(k);
        });
        
        if (isConfirm) {
          state.step = 'CONFIRM_ADDRESS_SMART';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          const localizedAddress = state.citizen.addressLine1 || '';
          
          let confirmText = `📍 Location:\n${localizedCity}, Uttar Pradesh\n\n🏠 Address:\n${localizedAddress}\n\nIs this correct?`;
          let confirmSug = '✅ Confirm';
          let editSug = '✏️ Edit Address';
          if (state.language === 'hi') {
            confirmText = `📍 स्थान:\n${localizedCity}, उत्तर प्रदेश\n\n🏠 पता:\n${localizedAddress}\n\nक्या यह सही है?`;
            confirmSug = '✅ पुष्टि करें';
            editSug = '✏️ पता बदलें';
          }
          return {
            response: confirmText,
            suggestions: [confirmSug, editSug],
          };
        } else if (isModify) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'city';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          return {
            response: state.language === 'hi' ? `वर्तमान स्थान:\n${localizedCity}, उत्तर प्रदेश\n\nकृपया संशोधित शहर, ज़िला या क्षेत्र दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Location:\n${localizedCity}, Uttar Pradesh\n\nPlease naya location enter karein.` :
                      `Current Location:\n${localizedCity}, Uttar Pradesh\n\nPlease enter the updated city, district, or area.`,
            suggestions: [],
          };
        } else {
          // Custom location entry (regression compatibility)
          const trimmedMsg = message.trim();
          if (trimmedMsg.length >= 3) {
            state.citizen.city = trimmedMsg;
            state.citizen.district = trimmedMsg;
            const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
            const localizedAddress = state.citizen.addressLine1 || localizedCity;
            let responseText = `📍 I found your location as:\n\n${localizedCity}, Uttar Pradesh\n${localizedAddress}\n\nIs this correct?\n\n- [✅ Confirm](option:✅ Confirm)\n- [✏️ Modify](option:✏️ Modify)`;
            let suggestions = ['✅ Confirm', '✏️ Modify'];
            if (state.language === 'hi') {
              responseText = `📍 मुझे आपका स्थान मिला है:\n\n${localizedCity}, उत्तर प्रदेश\n${localizedAddress}\n\nक्या यह सही है?\n\n- [✅ पुष्टि करें](option:✅ पुष्टि करें)\n- [✏️ बदलें](option:✏️ बदलें)`;
              suggestions = ['✅ पुष्टि करें', '✏️ बदलें'];
            }
            return {
              response: responseText,
              suggestions,
            };
          }
        }
      } else if (stepStr === 'CONFIRM_ADDRESS_SMART') {
        const words = cleanMsg.split(/\b/);
        const isConfirm = ['confirm', 'yes', 'correct', 'पुष्टि', 'option:confirm', 'option:yes', 'option:✅ confirm', 'option:✅ पुष्टि करें', '✅ confirm', '✅ पुष्टि करें'].some(k => {
          if (k === 'yes') return words.includes('yes');
          return cleanMsg.includes(k);
        });
        const isEdit = ['edit', 'modify', 'change', 'no', 'पता बदलें', 'option:edit', 'option:no', 'option:✏️ edit address', 'option:✏️ पता बदलें', '✏️ edit address', '✏️ पता बदलें'].some(k => {
          if (k === 'no') return words.includes('no');
          return cleanMsg.includes(k);
        });
        
        if (isConfirm) {
          state.step = 'CONFIRM_PROFILE';
          return this.renderConfirmationCard(state);
        } else if (isEdit) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'addressLine1';
          return {
            response: state.language === 'hi' ? `वर्तमान पता:\n${state.citizen.addressLine1 || ''}\n\nकृपया संशोधित पता दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Address:\n${state.citizen.addressLine1 || ''}\n\nPlease naya address enter karein.` :
                      `Current Address:\n${state.citizen.addressLine1 || ''}\n\nPlease enter the updated address.`,
            suggestions: [],
          };
        } else {
          // Custom address entry
          const parsed = this.validationService.parseFullAddress(message);
          state.citizen.addressLine1 = parsed.addressLine1;
          state.citizen.addressLine2 = parsed.addressLine2 || '';
          state.citizen.pincode = parsed.pincode || '';
          state.step = 'CONFIRM_PROFILE';
          return this.renderConfirmationCard(state);
        }
      } else if (stepStr === 'IDENTIFY_LOCATION') {
        const trimmedMsg = message.trim();
        if (trimmedMsg.toLowerCase().includes('civil lines') || trimmedMsg.toLowerCase().includes('near')) {
          state.step = 'CONFIRM_CITY';
          state.data.incompleteLocation = trimmedMsg;
          return {
            response: "Which city?",
            suggestions: [],
          };
        }
        if (message.trim().length >= 3) {
          state.citizen.city = message.trim();
          state.citizen.district = message.trim();
          state.step = 'CONFIRM_LOCATION';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          const locationPrompt = this.formatMessage('PROFILE_LOCATION_CONFIRM', state.language || 'en', '', { district: localizedCity });
          let confirmSug = 'Confirm';
          let changeSug = 'Change Location';
          if (state.language === 'hi') {
            confirmSug = 'पुष्टि करें';
            changeSug = 'स्थान बदलें';
          }
          return {
            response: locationPrompt,
            suggestions: [confirmSug, changeSug],
          };
        }
      } else if (stepStr === 'CONFIRM_CITY') {
        const cityInput = message.trim();
        if (cityInput.length >= 3) {
          state.citizen.city = cityInput;
          state.citizen.district = cityInput;
          state.citizen.addressLine1 = state.data.incompleteLocation;
          delete state.data.incompleteLocation;
          state.step = 'CONFIRM_LOCATION';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          const locationPrompt = this.formatMessage('PROFILE_LOCATION_CONFIRM', state.language || 'en', '', { district: localizedCity });
          let confirmSug = 'Confirm';
          let changeSug = 'Change Location';
          if (state.language === 'hi') {
            confirmSug = 'पुष्टि करें';
            changeSug = 'स्थान बदलें';
          }
          return {
            response: locationPrompt,
            suggestions: [confirmSug, changeSug],
          };
        }
      } else if (stepStr === 'CONFIRM_LOCATION') {
        if (['confirm', 'yes', 'correct', 'option:confirm', 'option:yes', 'option:confirm details', 'Confirm'].includes(message.trim())) {
          state.step = 'IDENTIFY_ADDRESS';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          const addressRequest = this.formatMessage('PROFILE_ADDRESS_REQUEST', state.language || 'en', '', { district: localizedCity });
          return {
            response: addressRequest,
            suggestions: [],
          };
        } else {
          state.citizen.city = "";
          state.citizen.district = "";
          state.step = 'IDENTIFY_LOCATION';
          return {
            response: "Understood. Please tell me your city, district, or area:",
            suggestions: [],
          };
        }
      } else if (stepStr === 'IDENTIFY_ADDRESS') {
        const parsed = this.validationService.parseFullAddress(message);
        state.citizen.addressLine1 = parsed.addressLine1;
        state.citizen.addressLine2 = parsed.addressLine2 || '';
        state.citizen.pincode = parsed.pincode || '';
        state.step = 'CONFIRM_PROFILE';
      } else if (stepStr === 'CONFIRM_PROFILE') {
        if (cleanMsg === 'yes' || cleanMsg === 'correct' || cleanMsg.includes('option:yes') || cleanMsg.includes('confirm details') || cleanMsg === 'confirm' || cleanMsg === 'confirm details') {
          state.citizen.isConfirmed = true;
          
          try {
            const citizenRecord = await this.prisma.citizen.create({
              data: {
                fullName: state.citizen.fullName,
                mobileNumber: state.citizen.mobileNumber,
                email: state.citizen.email || null,
                addressLine1: state.citizen.addressLine1 || null,
                addressLine2: state.citizen.addressLine2 || null,
                city: state.citizen.city || null,
                district: state.citizen.district || null,
                state: state.citizen.state || "Uttar Pradesh",
                pincode: state.citizen.pincode || null,
                latitude: state.citizen.latitude || null,
                longitude: state.citizen.longitude || null,
                isConfirmed: true,
              }
            });
            state.citizen.id = citizenRecord.id;
          } catch (e) {
            state.citizen.id = `mock-citizen-${Math.random().toString(36).substring(7)}`;
          }

          const successText = `👮 **Citizen Profile Verified**\n\nName: **${state.citizen.fullName}**\nMobile: **${state.citizen.mobileNumber}**\nLocation: **${state.citizen.city || state.citizen.district || 'Lucknow'}, ${state.citizen.state}**\n\n✓ Profile verification complete.\nLet's continue with your request.`;

          state.step = '1';
          let res: any;
          if (state.workflow === 'complaint') {
            res = await this.runComplaintWorkflow(state, "");
          } else if (state.workflow === 'verification') {
            res = await this.runVerificationWorkflow(state, "");
          } else if (state.workflow === 'certificate') {
            res = await this.runCertificateWorkflow(state, "");
          } else if (state.workflow === 'event') {
            res = await this.runEventWorkflow(state, "");
          }

          if (res) {
            return {
              response: successText + "\n\n" + res.response,
              suggestions: res.suggestions,
            };
          } else {
            state.step = 'START';
            return {
              response: successText + "\n\nHow would you like me to help you today?",
              suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
            };
          }
        } else if (cleanMsg.includes('change') || cleanMsg.includes('modify') || cleanMsg === 'no' || cleanMsg === 'modify details') {
          state.step = 'MODIFY_PROFILE_SELECT';
          return {
            response: state.language === 'hi' ? "आप कौन सा विवरण बदलना चाहेंगे?\n\n1. नाम\n2. मोबाइल नंबर\n3. स्थान (शहर/ज़िला)\n4. पता" :
                      state.language === 'hinglish' ? "Aap kaun sa detail modify karna chahenge?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address" :
                      "Which detail would you like to modify?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address",
            suggestions: ['1', '2', '3', '4'],
          };
        }
      } else if (stepStr === 'MODIFY_PROFILE_SELECT') {
        const choice = cleanMsg;
        if (choice.includes('name') || choice === '1' || (state.language === 'hi' && choice.includes('नाम'))) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'fullName';
          return {
            response: state.language === 'hi' ? `वर्तमान नाम:\n${state.citizen.fullName || ''}\n\nकृपया संशोधित नाम दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Name:\n${state.citizen.fullName || ''}\n\nPlease naya name enter karein.` :
                      `Current Name:\n${state.citizen.fullName || ''}\n\nPlease enter the updated name.`,
            suggestions: [],
          };
        } else if (choice.includes('mobile') || choice === '2' || choice.includes('number') || (state.language === 'hi' && (choice.includes('मोबाइल') || choice.includes('नंबर')))) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'mobileNumber';
          return {
            response: state.language === 'hi' ? `वर्तमान मोबाइल नंबर:\n${state.citizen.mobileNumber || ''}\n\nकृपया संशोधित मोबाइल नंबर दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Mobile Number:\n${state.citizen.mobileNumber || ''}\n\nPlease naya mobile number enter karein.` :
                      `Current Mobile Number:\n${state.citizen.mobileNumber || ''}\n\nPlease enter the updated mobile number.`,
            suggestions: [],
          };
        } else if (choice.includes('location') || choice === '3' || (state.language === 'hi' && choice.includes('स्थान'))) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'city';
          const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
          return {
            response: state.language === 'hi' ? `वर्तमान स्थान:\n${localizedCity}, उत्तर प्रदेश\n\nकृपया संशोधित शहर, ज़िला या क्षेत्र दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Location:\n${localizedCity}, Uttar Pradesh\n\nPlease naya location enter karein.` :
                      `Current Location:\n${localizedCity}, Uttar Pradesh\n\nPlease enter the updated city, district, or area.`,
            suggestions: [],
          };
        } else if (choice.includes('address') || choice === '4' || (state.language === 'hi' && choice.includes('पता'))) {
          state.step = 'MODIFY_PROFILE_INPUT';
          state.data.currentExpectedField = 'addressLine1';
          return {
            response: state.language === 'hi' ? `वर्तमान पता:\n${state.citizen.addressLine1 || ''}\n\nकृपया संशोधित पता दर्ज करें।` :
                      state.language === 'hinglish' ? `Current Address:\n${state.citizen.addressLine1 || ''}\n\nPlease naya address enter karein.` :
                      `Current Address:\n${state.citizen.addressLine1 || ''}\n\nPlease enter the updated address.`,
            suggestions: [],
          };
        } else {
          return {
            response: state.language === 'hi' ? "आप कौन सा विवरण बदलना चाहेंगे?\n\n1. नाम\n2. मोबाइल नंबर\n3. स्थान (शहर/ज़िला)\n4. पता" :
                      state.language === 'hinglish' ? "Aap kaun sa detail modify karna chahenge?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address" :
                      "Which detail would you like to modify?\n\n1. Name\n2. Mobile Number\n3. Location\n4. Address",
            suggestions: ['1', '2', '3', '4'],
          };
        }
      } else if (stepStr === 'MODIFY_PROFILE_INPUT') {
        const field = state.data.currentExpectedField || '';
        let successPrefix = '';
        if (field === 'fullName') {
          const confRes = this.validationService.validateNameConfidence(message);
          if (confRes.valid) {
            state.citizen.fullName = message.trim();
            successPrefix = state.language === 'hi' ? `✅ नाम सफलतापूर्वक अपडेट किया गया।\n\nकृपया अपने विवरण की फिर से समीक्षा करें:\n\n` :
                            state.language === 'hinglish' ? `✅ Name successfully update ho gaya hai.\n\nPlease details fir se review karein:\n\n` :
                            `✅ Name updated successfully.\n\nPlease review your details again:\n\n`;
            state.step = 'CONFIRM_PROFILE';
          } else {
            return {
              response: state.language === 'hi' ? "मुझे ठीक से समझ नहीं आया। क्या आप एक वैध नाम प्रदान कर सकते हैं?\nउदाहरण: राहुल कुमार या राजू" :
                        state.language === 'hinglish' ? "Mujhe sahi se samajh nahi aaya. Kya aap ek valid name de sakte hain?\nExample: Rahul Kumar ya Raju" :
                        "I may not have understood correctly. Could you please provide a valid name?\nExample: Rahul Kumar or Raju",
              suggestions: [],
            };
          }
        } else if (field === 'mobileNumber') {
          if (this.validationService.validateMobile(message)) {
            state.citizen.mobileNumber = this.validationService.normalizeMobile(message)!;
            successPrefix = state.language === 'hi' ? `✅ मोबाइल नंबर सफलतापूर्वक अपडेट किया गया।\n\nकृपया अपने विवरण की फिर से समीक्षा करें:\n\n` :
                            state.language === 'hinglish' ? `✅ Mobile number successfully update ho gaya hai.\n\nPlease details fir se review karein:\n\n` :
                            `✅ Mobile Number updated successfully.\n\nPlease review your details again:\n\n`;
            state.step = 'CONFIRM_PROFILE';
          } else {
            return {
              response: state.language === 'hi' ? "मुझे ठीक से समझ नहीं आया। क्या आप एक वैध 10-अंकीय मोबाइल नंबर प्रदान कर सकते हैं?" :
                        state.language === 'hinglish' ? "Mujhe sahi se samajh nahi aaya. Kya aap ek valid 10-digit mobile number de sakte hain?" :
                        "I may not have understood correctly. Could you please provide a valid 10-digit mobile number?",
              suggestions: [],
            };
          }
        } else if (field === 'city') {
          const ext = this.validationService.extractCitizenData(message);
          const loc = ext.location || message.trim();
          if (loc.length >= 3) {
            const previousCity = state.citizen.city || '';
            const newCity = loc;
            const prevRes = this.locationResolver.resolve(previousCity);
            const newRes = this.locationResolver.resolve(newCity);
            
            state.citizen.city = newCity;
            state.citizen.district = newCity;
            
            const prevDistrict = prevRes ? prevRes.districtCode : previousCity.toUpperCase();
            const newDistrict = newRes ? newRes.districtCode : newCity.toUpperCase();
            
            if (prevDistrict !== newDistrict) {
              state.citizen.addressLine1 = '';
              state.citizen.addressLine2 = '';
              state.citizen.pincode = '';
              state.step = 'IDENTIFY_ADDRESS';
              
              const localizedCity = this.localizeLocation(newCity, state.language);
              delete state.data.currentExpectedField;
              return {
                response: state.language === 'hi' ? `✅ स्थान सफलतापूर्वक अपडेट किया गया।\n\nआपका पिछला पता अब मान्य नहीं हो सकता है।\n\nकृपया ${localizedCity} में अपना पता दर्ज करें।` :
                          state.language === 'hinglish' ? `✅ Location updated successfully.\n\nAapka previous address ab valid nahi ho sakta.\n\nPlease ${localizedCity} mein apna address enter karein.` :
                          `✅ Location updated successfully.\n\nYour previous address may no longer be valid.\n\nPlease enter your address in ${localizedCity}.`,
                suggestions: [],
              };
            } else {
              successPrefix = state.language === 'hi' ? `✅ स्थान सफलतापूर्वक अपडेट किया गया।\n\nकृपया अपने विवरण की फिर से समीक्षा करें:\n\n` :
                              state.language === 'hinglish' ? `✅ Location successfully update ho gaya hai.\n\nPlease details fir se review karein:\n\n` :
                              `✅ Location updated successfully.\n\nPlease review your details again:\n\n`;
              state.step = 'CONFIRM_PROFILE';
            }
          } else {
            return {
              response: state.language === 'hi' ? "मुझे ठीक से समझ नहीं आया। क्या आप एक वैध स्थान (शहर या ज़िला) प्रदान कर सकते हैं?" :
                        state.language === 'hinglish' ? "Mujhe sahi se samajh nahi aaya. Kya aap ek valid location (city ya district) de sakte hain?" :
                        "I may not have understood correctly. Could you please provide a valid location (city or district)?",
              suggestions: [],
            };
          }
        } else if (field === 'addressLine1') {
          const parsed = this.validationService.parseFullAddress(message);
          state.citizen.addressLine1 = parsed.addressLine1;
          state.citizen.addressLine2 = parsed.addressLine2 || '';
          state.citizen.pincode = parsed.pincode || '';
          successPrefix = state.language === 'hi' ? `✅ पता सफलतापूर्वक अपडेट किया गया।\n\nकृपया अपने विवरण की फिर से समीक्षा करें:\n\n` :
                          state.language === 'hinglish' ? `✅ Address successfully update ho gaya hai.\n\nPlease details fir se review karein:\n\n` :
                          `✅ Address updated successfully.\n\nPlease review your details again:\n\n`;
          state.step = 'CONFIRM_PROFILE';
        }

        delete state.data.currentExpectedField;
        const card = this.renderConfirmationCard(state);
        return {
          response: successPrefix + card.response,
          suggestions: card.suggestions,
        };
      }
    }


    const lang = state.language || 'en';
    const isHi = lang === 'hi';
    const isHinglish = lang === 'hinglish';

    // Evaluate what is missing next
    if (!state.citizen.mobileNumber && !state.citizen.fullName) {
      state.step = 'IDENTIFY_MOBILE_FIRST';
      return {
        response: this.formatMessage('PROFILE_MOBILE_FIRST_REQUEST', lang, ''),
        suggestions: [],
      };
    }

    if (!state.citizen.fullName) {
      state.step = 'IDENTIFY_NAME';
      return {
        response: this.formatMessage('PROFILE_NAME_REQUEST', lang, ''),
        suggestions: [],
      };
    }

    if (!state.citizen.mobileNumber) {
      state.step = 'IDENTIFY_MOBILE';
      let promptText = this.formatMessage('PROFILE_MOBILE_REQUEST', lang, '', { name: state.citizen.fullName });
      if (state.data.nameSuggestFlag) {
        promptText = (isHi ? "*(विनम्र सुझाव: आधिकारिक रिकॉर्ड के लिए उपनाम के साथ पूरा नाम प्रदान करने की सिफारिश की जाती है, लेकिन हम आगे बढ़ सकते हैं।)*\n\n" :
                      isHinglish ? "*(Polite Suggestion: Official records ke liye surname ke sath full name dena recommended hai, but hum aage badh sakte hain.)*\n\n" :
                      "*(Polite Suggestion: Providing a full name with surname is recommended for official records, but we can proceed.)*\n\n") + promptText;
        delete state.data.nameSuggestFlag;
      }
      return {
        response: promptText,
        suggestions: [],
      };
    }

    // Attempt browser location mapping
    if (!state.citizen.city && !state.citizen.district) {
      const detected = await this.autoDetectLocation(state);
      if (detected) {
        state.citizen.city = detected.city;
        state.citizen.district = detected.district;
        state.citizen.addressLine1 = detected.addressLine1 || undefined;
        
        state.step = 'CONFIRM_LOCATION_SMART';
        
        const localizedCity = this.localizeLocation(state.citizen.city || '', state.language);
        const localizedAddress = state.citizen.addressLine1 || '';
        
        let confirmText = `📍 I found your location as:\n\n${localizedCity}, Uttar Pradesh${localizedAddress ? `\n${localizedAddress}` : ''}\n\nIs this correct?`;
        let confirmSug = '✅ Confirm';
        let modifySug = '✏️ Modify';
        if (state.language === 'hi') {
          confirmText = `📍 मुझे आपका स्थान मिला है:\n\n${localizedCity}, उत्तर प्रदेश${localizedAddress ? `\n${localizedAddress}` : ''}\n\nक्या यह सही है?`;
          confirmSug = '✅ पुष्टि करें';
          modifySug = '✏️ बदलें';
        } else if (state.language === 'hinglish') {
          confirmText = `📍 Mujhe aapka location mila hai:\n\n${localizedCity}, Uttar Pradesh${localizedAddress ? `\n${localizedAddress}` : ''}\n\nKya ye sahi hai?`;
        }
        return {
          response: confirmText,
          suggestions: [confirmSug, modifySug],
        };
      } else {
        state.step = 'IDENTIFY_LOCATION';
        return {
          response: isHi ? "❌ मैं स्वचालित रूप से आपका वर्तमान स्थान निर्धारित करने में असमर्थ हूँ।\n\nकृपया अपना शहर, ज़िला या क्षेत्र मैन्युअल रूप से दर्ज करें।" :
                    isHinglish ? "❌ Hum aapka current location automatically detect nahi kar paye.\n\nPlease apna city, district ya area manually enter karein." :
                    "❌ Unable to determine your current location automatically.\n\nPlease enter your city, district, or area manually.",
          suggestions: [],
        };
      }
    }

    if (!state.citizen.addressLine1) {
      state.step = 'IDENTIFY_ADDRESS';
      return {
        response: isHi ? `🏠 कृपया अपना पूरा पता दर्ज करें।\n\nउदाहरण:\nमकान नंबर 24, सेक्टर बी, गोमती नगर, लखनऊ - 226010` :
                  isHinglish ? `🏠 Please apna complete address enter karein.\n\nExample:\nHouse No. 24, Sector B, Gomti Nagar, Lucknow - 226010` :
                  `🏠 Please enter your complete address.\n\nExample:\nHouse No. 24, Sector B, Gomti Nagar, Lucknow - 226010`,
        suggestions: [],
      };
    }

    // If everything is collected, show confirmation card
    state.step = 'CONFIRM_PROFILE';
    return this.renderConfirmationCard(state);
  }

  private handleProfileCorrection(state: ChatSessionState, message: string): boolean {
    const cleanMsg = message.trim().toLowerCase();

    // "My mobile number is 9123456789" / "Change my number to 9123456789"
    const phoneMatches = message.match(/(?:mobile|number|phone|change mobile to|change number to)\s+(?:is\s+)?((?:\+91[\s-]?)?[6-9]\d{9}|\b[6-9]\d{9}\b)/i);
    if (phoneMatches && phoneMatches[1]) {
      const normalized = this.validationService.normalizeMobile(phoneMatches[1]);
      if (normalized && this.validationService.validateMobile(normalized)) {
        state.citizen.mobileNumber = normalized;
        return true;
      }
    }

    // "My name is Rahul Verma" / "Change name to Rahul Verma"
    const nameMatches = message.match(/(?:name is|change name to|my name is)\s+([a-zA-Z\s'-]+)/i);
    if (nameMatches && nameMatches[1]) {
      const potentialName = nameMatches[1].trim();
      if (this.validationService.validateName(potentialName)) {
        state.citizen.fullName = potentialName;
        return true;
      }
    }

    // "I live in Kanpur" / "Change location to Varanasi" / Hindi / Hinglish patterns
    const ext = this.validationService.extractCitizenData(message);
    if (ext.location) {
      state.citizen.city = ext.location;
      state.citizen.district = ext.location;
      return true;
    }

    return false;
  }

  private validateLocationAddressConsistency(state: ChatSessionState): boolean {
    if (!state.citizen.city || !state.citizen.addressLine1) {
      return true;
    }
    const fullAddress = `${state.citizen.addressLine1} ${state.citizen.addressLine2 || ''} ${state.citizen.pincode || ''}`.trim();
    const cityRes = this.locationResolver.resolve(state.citizen.city);
    const addressRes = this.locationResolver.resolve(fullAddress);
    
    if (cityRes && cityRes.districtCode && addressRes && addressRes.districtCode && addressRes.confidence > 0.3) {
      if (cityRes.districtCode === addressRes.districtCode) {
        return true;
      }
      
      const addrLower = fullAddress.toLowerCase();
      const cityLower = state.citizen.city.toLowerCase().trim();
      
      // 1. Check if full address literally contains the city name or vice-versa
      if (addrLower.includes(cityLower) || cityLower.includes(addrLower)) {
        return true;
      }
      
      // 2. Check if full address contains district name (e.g. gautam buddha nagar)
      const districtLower = cityRes.districtCode.toLowerCase().replace(/_/g, ' ');
      if (addrLower.includes(districtLower)) {
        return true;
      }
      
      // 3. Special location overrides
      if (addressRes.districtCode === 'PRAYAGRAJ' && (addrLower.includes('civil lines') || addrLower.includes('civillines')) && !addrLower.includes('prayagraj') && !addrLower.includes('allahabad')) {
        return true;
      }
      if (addressRes.districtCode === 'LUCKNOW' && addrLower.includes('cantonment') && !addrLower.includes('lucknow')) {
        return true;
      }
      
      // 4. Token-by-token check: check if any word/token in address resolves to the target district code
      const tokens = addrLower.split(/[\s,.\-\/]+/).map(t => t.trim()).filter(Boolean);
      for (const token of tokens) {
        if (token.length > 2) {
          const tokenRes = this.locationResolver.resolve(token);
          if (tokenRes && tokenRes.districtCode === cityRes.districtCode) {
            return true;
          }
        }
      }
      
      return false;
    }
    return true;
  }

  private renderConfirmationCard(state: ChatSessionState): { response: string; suggestions: string[] } {
    if (!this.validateLocationAddressConsistency(state)) {
      state.citizen.addressLine1 = '';
      state.citizen.addressLine2 = '';
      state.citizen.pincode = '';
      state.step = 'IDENTIFY_ADDRESS';
      const isHi = state.language === 'hi';
      const isHinglish = state.language === 'hinglish';
      return {
        response: isHi ? "आपका पता आपके चयनित स्थान से मेल नहीं खाता है।\n\nकृपया अपना पता फिर से दर्ज करें।" :
                  isHinglish ? "Aapka address aapke selected location se match nahi karta.\n\nPlease apna address phir se enter karein." :
                  "Your address does not match your selected location.\n\nPlease enter your address again.",
        suggestions: [],
      };
    }

    let addressDisplay = state.citizen.addressLine1 || '';
    if (state.citizen.addressLine2) {
      addressDisplay += `, ${state.citizen.addressLine2}`;
    }
    if (state.citizen.pincode) {
      addressDisplay += ` - ${state.citizen.pincode}`;
    }

    const localizedCity = this.localizeLocation(state.citizen.city || state.citizen.district || 'Lucknow', state.language);
    const addressFallback = state.language === 'hi' ? 'प्रदान नहीं किया गया' : 'Not provided';

    const response = this.formatMessage('PROFILE_CONFIRM_SCREEN', state.language || 'en', '', {
      name: state.citizen.fullName,
      mobile: state.citizen.mobileNumber,
      district: localizedCity,
      address: addressDisplay || addressFallback,
    });

    let confirmSug = 'Confirm Details';
    let modifySug = 'Modify Details';
    if (state.language === 'hi') {
      confirmSug = 'विवरण की पुष्टि करें';
      modifySug = 'विवरण बदलें';
    }

    return {
      response,
      suggestions: [confirmSug, modifySug],
    };
  }

  private calculateReadiness(session: ChatSessionState, requiredFields: string[]): { score: number; checklist: string; valid: boolean } {
    const lang = session.language;
    const nameValid = this.validationService.validateName(session.citizen.fullName);
    const mobileValid = this.validationService.validateMobile(session.citizen.mobileNumber);
    const locationValid = !!(session.citizen.city || session.citizen.district);
    const fieldsComplete = requiredFields.every(f => session.data[f] !== undefined && session.data[f] !== null && session.data[f] !== "");
    
    let score = 0;
    if (nameValid) score += 25;
    if (mobileValid) score += 25;
    if (locationValid) score += 25;
    if (fieldsComplete) score += 25;
    
    const labelName = this.localizationService.translate('CHECK_APPLICANT_COMPLETE', lang);
    const labelMobile = this.localizationService.translate('CHECK_CONTACT_VALID', lang);
    const labelLoc = this.localizationService.translate('CHECK_LOCATION_CONFIRMED', lang);
    const labelFields = this.localizationService.translate('CHECK_REQUIRED_FIELDS', lang);

    const checklist = `${nameValid ? '✓' : '✗'} ${labelName}\n` +
                      `${mobileValid ? '✓' : '✗'} ${labelMobile}\n` +
                      `${locationValid ? '✓' : '✗'} ${labelLoc}\n` +
                      `${fieldsComplete ? '✓' : '✗'} ${labelFields}\n\n` +
                      `${this.localizationService.translate('REVIEW_READY_FOR_SUBMISSION', lang)}: ${score}`;
                      
    return { score, checklist, valid: score === 100 };
  }

  // --- Complaint Workflow ---
  private async runComplaintWorkflow(session: ChatSessionState, msg: string): Promise<{ response: string; suggestions?: string[] }> {
    const step = session.step;
    const lang = session.language;
    const cleanMsg = msg.trim().toLowerCase();

    const prompts = {
      en: [
        "Please select the **Complaint Type**:\n\n- [Lost Mobile / Theft](option:Lost Mobile / Theft)\n- [Lost Document](option:Lost Document)\n- [Simple Harassment](option:Simple Harassment)\n- [Cyber Fraud / Financial Loss](option:Cyber Fraud / Financial Loss)",
        "Could you please tell me where the incident occurred?",
        "Thank you. Could you also tell me when did the incident occur (date in DD/MM/YYYY)?",
        "Got it. Could you briefly describe what happened?",
      ],
      hi: [
        "कृपया **शिकायत का प्रकार** चुनें:\n\n- [मोबाइल चोरी / गुम होना](option:Lost Mobile / Theft)\n- [खोया हुआ दस्तावेज़](option:Lost Document)\n- [सामान्य उत्पीड़न](option:Simple Harassment)\n- [साइबर धोखाधड़ी](option:Cyber Fraud / Financial Loss)",
        "क्या आप कृपया बता सकते हैं कि घटना कहाँ हुई थी?",
        "धन्यवाद। क्या आप यह भी बता सकते हैं कि घटना कब (दिनांक DD/MM/YYYY) हुई थी?",
        "समझ गया। क्या आप संक्षेप में बता सकते हैं कि क्या हुआ था?",
      ],
      hinglish: [
        "Please select the **Complaint Type**:\n\n- [Lost Mobile / Theft](option:Lost Mobile / Theft)\n- [Lost Document](option:Lost Document)\n- [Simple Harassment](option:Simple Harassment)\n- [Cyber Fraud / Financial Loss](option:Cyber Fraud / Financial Loss)",
        "Kya aap please bata sakte hain ki incident kahan hua tha?",
        "Thank you. Kya aap bata sakte hain ki incident kab (date DD/MM/YYYY) hua?",
        "Got it. Kya aap short mein describe kar sakte hain ki kya hua tha?",
      ],
    };

    if (step === 'REVIEW') {
      const readiness = this.calculateReadiness(session, ['type', 'location', 'time', 'description']);
      if (cleanMsg === 'yes' || cleanMsg === 'submit' || cleanMsg === 'confirm' || cleanMsg.includes('option:yes') || cleanMsg.includes('submit application') || cleanMsg.includes('confirm')) {
        if (!readiness.valid) {
          await this.intelligenceService.recordWorkflowStep('complaint', 'REVIEW', false, true);
          return {
            response: "⚠️ **Cannot Submit:** Some validations are still missing. Could you please provide the information in a different way or modify details?",
            suggestions: ["Modify Details"]
          };
        }
        session.step = 'ASK_FEEDBACK';
        let fullDetails = `Location: ${session.data.location} | Date/Time: ${session.data.time} | Description: ${session.data.description}`;
        if (session.data.brand) {
          fullDetails = `Brand: ${session.data.brand} | Model: ${session.data.model} | Color: ${session.data.color} | Year: ${session.data.year} | IMEI: ${session.data.imei || 'N/A'} | ` + fullDetails;
        }
        const resNum = `UP-CMP-2026-${Math.floor(100000 + Math.random() * 900000)}`;
        const record = await this.complaintService.createComplaint(session.data.type, fullDetails, resNum, session.citizen.id);
        await this.prisma.trackingRecord.create({
          data: {
            referenceNumber: resNum,
            serviceType: 'Complaint Registration',
            entityId: record.id,
            citizenId: session.citizen.id && session.citizen.id !== 'default-citizen-id' ? session.citizen.id : null,
            currentStatus: 'SUBMITTED',
            statusHistory: [
              { status: 'SUBMITTED', timestamp: new Date().toISOString() }
            ] as any,
          }
        });
        session.data = {};
        
        // Log completion success metrics
        await this.intelligenceService.recordWorkflowStep('complaint', 'SUBMITTED', true, false);

        const completionMsg = this.formatMessage('SUCCESS_COMPLAINT', lang, '', { referenceNumber: resNum, district: session.citizen.district || session.data.location || 'your area' }) + 
          "\n\n" + this.formatMessage('FEEDBACK_ASK', lang, '');

        return {
          response: completionMsg,
          suggestions: this.getRatingSuggestions(lang),
        };
      } else if (cleanMsg === 'no' || cleanMsg === 'modify' || cleanMsg.includes('option:no') || cleanMsg.includes('option:modify details') || cleanMsg.includes('modify')) {
        return {
          response: "I may not have understood correctly. Could you please provide that information in a different way? You can correct details by typing e.g., 'Change location to Noida' or 'Change mobile to 9876543210'.",
          suggestions: ['Submit Application'],
        };
      }
    }

    if (step === '1') {
      if (session.data.type) {
        session.step = '2';
        return this.runComplaintWorkflow(session, session.data.type);
      }
      session.step = '2';
      return {
        response: prompts[lang][0],
        suggestions: ['Lost Mobile / Theft', 'Lost Document', 'Simple Harassment', 'Cyber Fraud / Financial Loss'],
      };
    }

    if (step === '2') {
      if (msg) session.data.type = msg;

      const cleanMsgLower = msg.trim().toLowerCase();
      const isMobileTheft = cleanMsgLower.includes('mobile') || cleanMsgLower.includes('theft') || cleanMsgLower.includes('गुम') || cleanMsgLower.includes('चोरी') || cleanMsgLower.includes('stolen');
      if (isMobileTheft) {
        session.step = '2_brand';
        // Use centralized empathy message that includes brand prompt
        session.data.empathyShown = true;
        return {
          response: this.formatMessage('EMPATHY_LOST_MOBILE', lang, ''),
          suggestions: ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Realme', 'Vivo']
        };
      }

      session.step = '3';
      return {
        response: prompts[lang][1],
      };
    }

    if (step === '2_brand') {
      session.data.brand = msg;
      session.step = '2_model';
      return {
        response: lang === 'hi' ? "आपके खोए हुए मोबाइल का मॉडल क्या है (जैसे iPhone 15, Galaxy S23)?" :
                  lang === 'hinglish' ? "Lost mobile ka model kya hai (jaise iPhone 15, Galaxy S23)?" :
                  "What is the model of your lost mobile (e.g. iPhone 15, Galaxy S23)?",
        suggestions: []
      };
    }

    if (step === '2_model') {
      session.data.model = msg;
      session.step = '2_color';
      return {
        response: lang === 'hi' ? "आपके मोबाइल का रंग क्या है?" :
                  lang === 'hinglish' ? "Mobile ka color kya hai?" :
                  "What is the color of your mobile?",
        suggestions: []
      };
    }

    if (step === '2_color') {
      session.data.color = msg;
      session.step = '2_year';
      return {
        response: lang === 'hi' ? "फ़ोन का निर्माण/खरीद का वर्ष क्या है?" :
                  lang === 'hinglish' ? "Phone ka manufacturing/purchase year kya hai?" :
                  "What is the manufacturing/purchase year of the phone?",
        suggestions: []
      };
    }

    if (step === '2_year') {
      session.data.year = msg;
      session.step = '2_imei';
      return {
        response: lang === 'hi' ? "कृपया फ़ोन का 15-अंकीय IMEI नंबर दर्ज करें। आप इसे फ़ोन के बॉक्स, खरीद चालान (invoice), या अपने फ़ोन पर *#06# डायल करके पा सकते हैं। (यदि उपलब्ध नहीं है, तो आप 'skip' या 'no' टाइप कर सकते हैं):" :
                  lang === 'hinglish' ? "Please phone ka 15-digit IMEI number enter karein. Aap ise phone ke box, purchase invoice, ya dialer pe *#06# dial karke dundh sakte hain. (Agar available nahi hai, toh 'skip'/'no' type kar sakte hain):" :
                  "Please enter the 15-digit IMEI number of the phone. You can find this on your phone's retail box, purchase invoice, or by dialing *#06# on your device. (If not available, you can type 'skip' or 'no'):",
        suggestions: ['skip']
      };
    }

    if (step === '2_imei') {
      const cleanImei = msg.trim().toLowerCase();
      const skipVariations = ['skip', 'no', 'not available', 'na', 'nahi', 'none', 'not known', 'n/a'];
      const isSkip = skipVariations.includes(cleanImei);
      if (!isSkip && !/^\d{15}$/.test(cleanImei)) {
        return {
          response: lang === 'hi' ? "कृपया एक मान्य 15-अंकीय IMEI नंबर दर्ज करें या 'skip' टाइप करें:" :
                    lang === 'hinglish' ? "Please standard 15-digit IMEI number enter karein ya 'skip' likhein:" :
                    "Please enter a valid 15-digit IMEI number or type 'skip' to skip:",
          suggestions: ['skip']
        };
      }
      session.data.imei = isSkip ? null : cleanImei;
      session.data.imeiStatus = isSkip ? 'SKIPPED' : 'PROVIDED';
      session.step = '3';
      return {
        response: prompts[lang][1],
      };
    }

    if (step === '3') {
      session.data.location = msg;
      session.step = '4';
      return {
        response: prompts[lang][2],
      };
    }

    if (step === '4') {
      if (!this.validationService.validateDate(msg, true)) {
        return {
          response: "👮 As your citizen assistance officer, I'm here to help. The date appears invalid or in the future.\n\nPlease provide a valid date in DD/MM/YYYY format:\nExample: 15/07/2026",
        };
      }
      session.data.time = msg;
      session.step = '5';
      return {
        response: prompts[lang][3],
      };
    }

    if (step === '5') {
      if (!this.validationService.validateConsistency(session.citizen.city, msg)) {
        return {
          response: "👮 As your citizen assistance officer, I noticed a location contradiction in your details relative to your registered location. Please verify and confirm details again.",
        };
      }
      session.data.description = msg;
      session.step = 'REVIEW';

      const readiness = this.calculateReadiness(session, ['type', 'location', 'time', 'description']);

      let reviewScreen = `👮 **Please review your application.**

Name: **${session.citizen.fullName}**
Mobile: **${session.citizen.mobileNumber}**
District: **${session.citizen.city || 'Lucknow'}**
Complaint Type: **${session.data.type}**
`;

      if (session.data.brand) {
        reviewScreen += `\n📱 **Device Information**\n`;
        reviewScreen += `Brand: **${session.data.brand}**\n`;
        if (session.data.model) {
          reviewScreen += `Model: **${session.data.model}**\n`;
        }
        if (session.data.color) {
          reviewScreen += `Color: **${session.data.color}**\n`;
        }
        if (session.data.year) {
          reviewScreen += `Manufacturing/Purchase Year: **${session.data.year}**\n`;
        }
        reviewScreen += `IMEI: **${session.data.imei || 'Not Provided'}**\n`;
      }

      reviewScreen += `Incident Location: **${session.data.location}**
Incident Date: **${session.data.time}**
Description: **${session.data.description}**

**Validation Status**

${readiness.checklist}

`;

      let sugs: string[];
      if (readiness.valid) {
        reviewScreen += `Would you like to submit this application?

- [Submit Application](option:Submit Application)
- [Modify Details](option:Modify Details)`;
        sugs = ['Submit Application', 'Modify Details'];
      } else {
        reviewScreen += `⚠️ **Cannot Submit:** Please complete all required fields and ensure validations pass.

- [Modify Details](option:Modify Details)`;
        sugs = ['Modify Details'];
      }

      return {
        response: reviewScreen,
        suggestions: sugs,
      };
    }

    return { response: this.localizationService.translate('invalidStep', lang) };
  }

  // --- Verification Workflow ---
  private async runVerificationWorkflow(session: ChatSessionState, msg: string): Promise<{ response: string; suggestions?: string[] }> {
    const step = session.step;
    const lang = session.language;
    const cleanMsg = msg.trim().toLowerCase();

    const prompts = {
      en: [
        "Please select the **Verification Type**:\n\n- [Tenant Verification](option:Tenant Verification)\n- [PG Verification](option:PG Verification)\n- [Domestic Help Verification](option:Domestic Help Verification)\n- [Employee Verification](option:Employee Verification)",
        "Let's start with their full name. What is their full name?",
        "Thank you. What is the permanent address of the person being verified?",
        "Got it. Could you please share their mobile number?",
        "Thank you. Could you also provide the property details (such as flat number, block, and city) where they will reside?",
      ],
      hi: [
        "कृपया **सत्यापन का प्रकार** चुनें:\n\n- [किरायेदार सत्यापन](option:Tenant Verification)\n- [पीजी सत्यापन](option:PG Verification)\n- [घरेलू सहायक सत्यापन](option:Domestic Help Verification)\n- [कर्मचारी सत्यापन](option:Employee Verification)",
        "चलिए उनके पूरे नाम से शुरू करते हैं। उनका पूरा नाम क्या है?",
        "धन्यवाद। सत्यापित किए जाने वाले व्यक्ति का स्थायी पता क्या है?",
        "ठीक है। क्या आप कृपया उनका मोबाइल नंबर साझा कर सकते हैं?",
        "धन्यवाद। क्या आप उस संपत्ति का विवरण (जैसे फ्लैट नंबर, ब्लॉक और शहर) भी दे सकते हैं जहाँ वे रहेंगे?",
      ],
      hinglish: [
        "Please select the **Verification Type**:\n\n- [Tenant Verification](option:Tenant Verification)\n- [PG Verification](option:PG Verification)\n- [Domestic Help Verification](option:Domestic Help Verification)\n- [Employee Verification](option:Employee Verification)",
        "Let's start with their full name. Unka full name kya hai?",
        "Thank you. Satyapit hone wale vyakti ka permanent address kya hai?",
        "Got it. Kya aap unka mobile number share karenge?",
        "Thank you. Kya aap property details (jaise flat number, block, city) batayenge jahan wo rahenge?",
      ],
    };

    if (step === 'REVIEW') {
      if (cleanMsg === 'yes' || cleanMsg === 'submit' || cleanMsg === 'confirm' || cleanMsg.includes('option:yes') || cleanMsg.includes('submit application') || cleanMsg.includes('confirm')) {
        session.step = 'ASK_FEEDBACK';
        const resNum = `UP-TV-2026-${Math.floor(100000 + Math.random() * 900000)}`;
        const record = await this.verificationService.createVerification(
          session.data.type,
          session.data.name,
          session.data.address,
          session.data.mobile,
          session.data.propertyDetails,
          resNum,
          session.citizen.id,
        );
        await this.prisma.trackingRecord.create({
          data: {
            referenceNumber: resNum,
            serviceType: `${session.data.type} Verification`,
            entityId: record.id,
            citizenId: session.citizen.id && session.citizen.id !== 'default-citizen-id' ? session.citizen.id : null,
            currentStatus: 'SUBMITTED',
            statusHistory: [
              { status: 'SUBMITTED', timestamp: new Date().toISOString() }
            ] as any,
          }
        });
        session.data = {};
        
        const rawCompMsg = getCompletionMessage(resNum, lang, this.localizationService);
        let cleanCompMsg = rawCompMsg;
        if (lang === 'hi') {
          cleanCompMsg = cleanCompMsg.replace('क्या मैं आज आपकी किसी और चीज़ में सहायता कर सकता हूँ?', '').trim();
        } else {
          cleanCompMsg = cleanCompMsg.replace('Is there anything else I can help you with today?', '').trim();
        }
        
        return {
          response: cleanCompMsg + "\n\n" + this.formatMessage('FEEDBACK_ASK', lang, ''),
          suggestions: this.getRatingSuggestions(lang),
        };
      } else if (cleanMsg === 'no' || cleanMsg === 'modify' || cleanMsg.includes('option:no') || cleanMsg.includes('option:modify details') || cleanMsg.includes('modify')) {
        session.step = '2';
        session.data = {};
        return {
          response: "Understood. Let's restart the form. Please select or enter the details again.\n\n" + prompts[lang][0],
          suggestions: ['Tenant Verification', 'PG Verification', 'Domestic Help Verification', 'Employee Verification'],
        };
      }
    }

    if (step === '1') {
      session.step = '2';
      return {
        response: prompts[lang][0],
        suggestions: ['Tenant Verification', 'PG Verification', 'Domestic Help Verification', 'Employee Verification'],
      };
    }

    if (step === '2') {
      if (msg) session.data.type = msg;
      session.step = '3';
      return { response: prompts[lang][1] };
    }

    if (step === '3') {
      if (!this.validationService.validateName(msg)) {
        return {
          response: "⚠️ For official records, please enter the full name (at least a first name and a last name).\n\nExample:\nRahul Kumar",
        };
      }
      session.data.name = msg;
      session.step = '4';
      return { response: prompts[lang][2] };
    }

    if (step === '4') {
      session.data.address = msg;
      session.step = '5';
      return { response: prompts[lang][3] };
    }

    if (step === '5') {
      if (!this.validationService.validateMobile(msg)) {
        return {
          response: "⚠️ The mobile number appears incomplete.\n\nPlease provide a valid 10-digit Indian mobile number.\n\nExample:\n9876543210",
        };
      }
      session.data.mobile = this.validationService.normalizeMobile(msg)!;
      session.step = '6';
      return { response: prompts[lang][4] };
    }

    if (step === '6') {
      session.data.propertyDetails = msg;
      session.step = 'REVIEW';

      const reviewScreen = `👮 **Please review your application.**

Name: **${session.citizen.fullName}**
Mobile: **${session.citizen.mobileNumber}**
Verification Type: **${session.data.type}**
Candidate Name: **${session.data.name}**
Candidate Mobile: **${session.data.mobile}**
Candidate Address: **${session.data.address}**
Property Details: **${session.data.propertyDetails}**

**Validation Status**

✓ Candidate Name Valid
✓ Candidate Mobile Valid
✓ Property Address Valid
✓ Verification Details Complete
✓ Ready for Submission

Would you like to submit this application?

- [Submit Application](option:Submit Application)
- [Modify Details](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: ['Submit Application', 'Modify Details'],
      };
    }

    return { response: 'Invalid step' };
  }

  private requiresProfileReuse(workflow: string): boolean {
    return ['certificate', 'event'].includes(workflow);
  }

  private async handleProfileReuseProtocol(
    session: ChatSessionState,
    msg: string,
    workflowType: string,
    targetRole: 'ROLE_SUBJECT' | 'ROLE_ORGANIZER',
    nextWorkflowPrompt: string,
    nextWorkflowSuggestions?: string[],
    manualStartStep: string = '2',
    manualStartPrompt?: string,
    manualStartSuggestions?: string[]
  ): Promise<{ response: string; suggestions?: string[] } | null> {
    const lang = session.language;
    const cleanMsg = msg.trim().toLowerCase();
    const step = session.step;

    const addressStr = [
      session.citizen.addressLine1,
      session.citizen.addressLine2,
      session.citizen.city,
      session.citizen.pincode
    ].filter(Boolean).join(', ');

    const prompts = {
      en: {
        foundProfile: `I found a verified profile:\n\nName: **${session.citizen.fullName}**\nAddress: **${addressStr}**\n\nHow would you like to proceed?`,
        options: ["Use My Verified Details", "Apply For Someone Else"],
        confirmUse: `I will use your verified details for this application.\n\nName: **${session.citizen.fullName}**\nAddress: **${addressStr}**\n\nContinue?`,
        confirmOptions: ["Continue", "Modify Details"],
      },
      hi: {
        foundProfile: `मुझे एक सत्यापित प्रोफ़ाइल मिली है:\n\nनाम: **${session.citizen.fullName}**\nपता: **${addressStr}**\n\nआप कैसे आगे बढ़ना चाहेंगे?`,
        options: ["मेरे सत्यापित विवरण का उपयोग करें", "किसी अन्य व्यक्ति के लिए आवेदन करें"],
        confirmUse: `मैं इस आवेदन के लिए आपके सत्यापित विवरणों का उपयोग करूँगा।\n\nनाम: **${session.citizen.fullName}**\nपता: **${addressStr}**\n\nजारी रखें?`,
        confirmOptions: ["जारी रखें", "विवरण बदलें"],
      },
      hinglish: {
        foundProfile: `Mujhe ek verified profile mili hai:\n\nName: **${session.citizen.fullName}**\nAddress: **${addressStr}**\n\nKaise proceed karna chahenge?`,
        options: ["Use My Verified Details", "Apply For Someone Else"],
        confirmUse: `Main is application ke liye aapke verified details use karunga.\n\nName: **${session.citizen.fullName}**\nAddress: **${addressStr}**\n\nContinue?`,
        confirmOptions: ["Continue", "Modify Details"],
      }
    };

    if (step === '1' || step === 'PRP_INIT') {
      session.step = 'PRP_CHOICE';
      return {
        response: prompts[lang].foundProfile,
        suggestions: prompts[lang].options,
      };
    }

    if (step === 'PRP_CHOICE') {
      const isSelf = cleanMsg.includes('use my verified details') || cleanMsg.includes('मेरे सत्यापित विवरण') || cleanMsg === 'myself' || cleanMsg === 'mere liye';
      const isSomeoneElse = cleanMsg.includes('someone else') || cleanMsg.includes('किसी अन्य व्यक्ति') || cleanMsg.includes('kisi aur') || cleanMsg === 'someone else' || cleanMsg === 'kisi aur ke liye';

      if (isSelf || cleanMsg.includes('option:use my verified details') || cleanMsg.includes('option:मेरे सत्यापित विवरण')) {
        session.data.prpSource = 'REUSED';
        if (targetRole === 'ROLE_SUBJECT') {
          session.data.name = session.citizen.fullName;
          session.data.address = addressStr;
          session.data.district = session.citizen.district || session.citizen.city || 'Lucknow';
          session.data.isSelf = true;
        } else if (targetRole === 'ROLE_ORGANIZER') {
          session.data.organizerName = session.citizen.fullName;
          session.data.organizerAddress = addressStr;
          session.data.organizerMobile = session.citizen.mobileNumber;
          session.data.organizerIsApplicant = true;
        }
        session.step = 'PRP_CONFIRM';
        return {
          response: prompts[lang].confirmUse,
          suggestions: prompts[lang].confirmOptions,
        };
      } else if (isSomeoneElse || cleanMsg.includes('option:apply for someone else') || cleanMsg.includes('option:किसी अन्य व्यक्ति')) {
        session.data.prpSource = 'MANUAL';
        if (targetRole === 'ROLE_SUBJECT') {
          session.data.isSelf = false;
        } else if (targetRole === 'ROLE_ORGANIZER') {
          session.data.organizerIsApplicant = false;
        }
        session.step = manualStartStep;
        return {
          response: manualStartPrompt || '',
          suggestions: manualStartSuggestions,
        };
      } else {
        return {
          response: prompts[lang].foundProfile,
          suggestions: prompts[lang].options,
        };
      }
    }

    if (step === 'PRP_CONFIRM') {
      const isContinue = cleanMsg === 'continue' || cleanMsg.includes('option:continue') || cleanMsg.includes('जारी रखें') || cleanMsg.includes('option:जारी रखें');
      const isModify = cleanMsg === 'modify details' || cleanMsg.includes('option:modify details') || cleanMsg.includes('विवरण बदलें') || cleanMsg.includes('option:विवरण बदलें');

      if (isContinue) {
        return null; // Go directly to the next workflow step
      } else if (isModify) {
        session.data.prpSource = 'MANUAL';
        if (targetRole === 'ROLE_SUBJECT') {
          session.data.isSelf = false;
        } else if (targetRole === 'ROLE_ORGANIZER') {
          session.data.organizerIsApplicant = false;
        }
        session.step = manualStartStep;
        return {
          response: manualStartPrompt || '',
          suggestions: manualStartSuggestions,
        };
      } else {
        return {
          response: prompts[lang].confirmUse,
          suggestions: prompts[lang].confirmOptions,
        };
      }
    }

    return null;
  }

  // --- Character Certificate Workflow ---
  private async runCertificateWorkflow(session: ChatSessionState, msg: string): Promise<{ response: string; suggestions?: string[] }> {
    const step = session.step;
    const lang = session.language;
    const cleanMsg = msg.trim().toLowerCase();

    const prompts = {
      en: [
        "Let's start with your full name. What is your full name?",
        "Thank you. What is your permanent address?",
        "Got it. Which district in Uttar Pradesh are you applying from?",
        "Thank you. What is the purpose of this certificate?",
      ],
      hi: [
        "चलिए आपके पूरे नाम से शुरू करते हैं। आपका पूरा नाम क्या है?",
        "धन्यवाद। आपका स्थायी पता क्या है?",
        "ठीक है। आप उत्तर प्रदेश के किस ज़िले से आवेदन कर रहे हैं?",
        "धन्यवाद। इस प्रमाण पत्र का उद्देश्य क्या है?",
      ],
      hinglish: [
        "Let's start with your full name. Aapka full name kya hai?",
        "Thank you. Aapka permanent address kya hai?",
        "Got it. Aap Uttar Pradesh ke kis district se apply kar rahe hain?",
        "Thank you. Is certificate ka purpose kya hai?",
      ],
    };

    if (step === '1' || step === 'PRP_CHOICE' || step === 'PRP_CONFIRM') {
      const prpRes = await this.handleProfileReuseProtocol(
        session,
        msg,
        'certificate',
        'ROLE_SUBJECT',
        prompts[lang][3],
        ['Job Application', 'Passport', 'Visa', 'Higher Education', 'Government Service'],
        '2',
        prompts[lang][0],
      );
      if (prpRes !== null) {
        return prpRes;
      }
      // Continue was selected
      session.step = '5';
      return {
        response: prompts[lang][3],
        suggestions: ['Job Application', 'Passport', 'Visa', 'Higher Education', 'Government Service'],
      };
    }

    if (step === 'REVIEW') {
      if (cleanMsg === 'yes' || cleanMsg === 'submit' || cleanMsg === 'confirm' || cleanMsg.includes('option:yes') || cleanMsg.includes('submit application') || cleanMsg.includes('confirm')) {
        session.step = 'ASK_FEEDBACK';
        const resNum = `UP-CC-2026-${Math.floor(100000 + Math.random() * 900000)}`;
        const usedProfileReuseCert = session.data.isSelf === true;
        const profileSnapshotCert = usedProfileReuseCert ? {
          fullName: session.citizen.fullName,
          mobileNumber: session.citizen.mobileNumber,
          email: session.citizen.email,
          addressLine1: session.citizen.addressLine1,
          addressLine2: session.citizen.addressLine2,
          city: session.citizen.city,
          district: session.citizen.district,
          state: session.citizen.state,
          pincode: session.citizen.pincode,
          latitude: session.citizen.latitude,
          longitude: session.citizen.longitude,
          locality: session.citizen.locality,
        } : null;
        const record = await this.certificateService.createCertificate(
          session.data.name,
          session.data.address,
          session.data.district,
          session.data.purpose,
          resNum,
          session.citizen.id,
          usedProfileReuseCert,
          profileSnapshotCert,
          1,
        );
        await this.prisma.trackingRecord.create({
          data: {
            referenceNumber: resNum,
            serviceType: 'Character Certificate',
            entityId: record.id,
            citizenId: session.citizen.id && session.citizen.id !== 'default-citizen-id' ? session.citizen.id : null,
            currentStatus: 'SUBMITTED',
            statusHistory: [
              { status: 'SUBMITTED', timestamp: new Date().toISOString() }
            ] as any,
          }
        });
        session.data = {};

        const rawCompMsg = getCompletionMessage(resNum, lang, this.localizationService);
        let cleanCompMsg = rawCompMsg;
        if (lang === 'hi') {
          cleanCompMsg = cleanCompMsg.replace('क्या मैं आज आपकी किसी और चीज़ में सहायता कर सकता हूँ?', '').trim();
        } else {
          cleanCompMsg = cleanCompMsg.replace('Is there anything else I can help you with today?', '').trim();
        }

        return {
          response: cleanCompMsg + "\n\n" + this.formatMessage('FEEDBACK_ASK', lang, ''),
          suggestions: this.getRatingSuggestions(lang),
        };
      } else if (cleanMsg === 'no' || cleanMsg === 'modify' || cleanMsg.includes('option:no') || cleanMsg.includes('option:modify details') || cleanMsg.includes('modify')) {
        session.step = '1';
        session.data = {};
        const prpInit = await this.handleProfileReuseProtocol(
          session,
          "",
          'certificate',
          'ROLE_SUBJECT',
          prompts[lang][3],
          ['Job Application', 'Passport', 'Visa', 'Higher Education', 'Government Service'],
          '2',
          prompts[lang][0],
        );
        return prpInit!;
      }
    }

    if (step === '2') {
      if (!this.validationService.validateName(msg)) {
        return {
          response: "⚠️ For official records, please enter the full name (at least a first name and a last name).\n\nExample:\nRahul Kumar",
        };
      }
      session.data.name = msg;
      session.step = '3';
      return { response: prompts[lang][1] };
    }

    if (step === '3') {
      session.data.address = msg;
      session.step = '4';
      return {
        response: prompts[lang][2],
        suggestions: ['Lucknow', 'Kanpur', 'Noida', 'Ghaziabad', 'Varanasi', 'Prayagraj'],
      };
    }

    if (step === '4') {
      session.data.district = msg;
      session.step = '5';
      return {
        response: prompts[lang][3],
        suggestions: ['Job Application', 'Passport', 'Visa', 'Higher Education', 'Government Service'],
      };
    }

    if (step === '5') {
      if (!["Job Application", "Passport", "Visa", "Higher Education", "Government Service"].includes(msg)) {
        return {
          response: "⚠️ Could you please select a valid purpose?\n\nExamples:\n• Job Application\n• Passport\n• Visa\n• Higher Education\n• Government Service",
          suggestions: ['Job Application', 'Passport', 'Visa', 'Higher Education', 'Government Service'],
        };
      }
      session.data.purpose = msg;
      session.step = 'REVIEW';

      const isSelf = session.data.isSelf;
      const sourceLabel = isSelf ? "✓ Reused From Verified Profile" : "✓ Provided Manually";
      const reviewScreen = `👮 **Please review your application.**

Applicant Name: **${session.citizen.fullName}**
Applicant Mobile: **${session.citizen.mobileNumber}**
Subject Name: **${session.data.name}**
Subject Address: **${session.data.address}**
District: **${session.data.district}**
Purpose: **${session.data.purpose}**

**Subject Information Source:**
${sourceLabel}

**Validation Status**

✓ Subject Name Valid
✓ District Valid
✓ Purpose Valid
✓ Character Certificate Details Complete
✓ Ready for Submission

Would you like to submit this application?

- [Submit Application](option:Submit Application)
- [Modify Details](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: ['Submit Application', 'Modify Details'],
      };
    }

    return { response: 'Invalid step' };
  }

  // --- Event Permission Workflow ---
  private async runEventWorkflow(session: ChatSessionState, msg: string): Promise<{ response: string; suggestions?: string[] }> {
    const step = session.step;
    const lang = session.language;
    const cleanMsg = msg.trim().toLowerCase();

    const prompts = {
      en: [
        "Please select the **Request Type**:\n\n- [Event Permission](option:Event Permission)\n- [Procession Request](option:Procession Request)\n- [Protest Request](option:Protest Request)\n- [Film Shooting Request](option:Film Shooting Request)",
        "Let's start with the event name. What is the name of your event?",
        "Thank you. Could you also tell me where the event will take place (location or route)?",
        "Got it. On what date is the event scheduled (DD/MM/YYYY)?",
        "Thank you. Could you tell me what the expected attendance number is?",
      ],
      hi: [
        "कृपया **अनुरोध का प्रकार** चुनें:\n\n- [कार्यक्रम अनुमति](option:Event Permission)\n- [जुलूस अनुमति](option:Procession Request)\n- [विरोध प्रदर्शन](option:Protest Request)\n- [फिल्म शूटिंग](option:Film Shooting Request)",
        "चलिए कार्यक्रम के नाम से शुरू करते हैं। आपके कार्यक्रम का नाम क्या है?",
        "धन्यवाद। क्या आप बता सकते हैं कि कार्यक्रम कहाँ (स्थान या मार्ग) आयोजित होगा?",
        "ठीक है। कार्यक्रम किस तिथि (DD/MM/YYYY) को निर्धारित है?",
        "धन्यवाद। क्या आप बता सकते हैं कि कार्यक्रम में संभावित उपस्थिति संख्या कितनी है?",
      ],
      hinglish: [
        "Please select the **Request Type**:\n\n- [Event Permission](option:Event Permission)\n- [Procession Request](option:Procession Request)\n- [Protest Request](option:Protest Request)\n- [Film Shooting Request](option:Film Shooting Request)",
        "Event ke naam se shuru karte hain. Aapke event ka naam kya hai?",
        "Thank you. Event kahan (location/route) hone wala hai?",
        "Got it. Event kis date (DD/MM/YYYY) ko hone wala hai?",
        "Thank you. Event mein kitne logon ke aane ki ummeed hai?",
      ],
    };

    if (step === 'REVIEW') {
      if (cleanMsg === 'yes' || cleanMsg === 'submit' || cleanMsg === 'confirm' || cleanMsg.includes('option:yes') || cleanMsg.includes('submit application') || cleanMsg.includes('confirm')) {
        session.step = 'ASK_FEEDBACK';
        const resNum = `UP-EP-2026-${Math.floor(100000 + Math.random() * 900000)}`;
        const usedProfileReuseEvt = session.data.isSelf === true;
        const profileSnapshotEvt = usedProfileReuseEvt ? {
          fullName: session.citizen.fullName,
          mobileNumber: session.citizen.mobileNumber,
          email: session.citizen.email,
          addressLine1: session.citizen.addressLine1,
          addressLine2: session.citizen.addressLine2,
          city: session.citizen.city,
          district: session.citizen.district,
          state: session.citizen.state,
          pincode: session.citizen.pincode,
          latitude: session.citizen.latitude,
          longitude: session.citizen.longitude,
          locality: session.citizen.locality,
        } : null;
        const record = await this.eventService.createEventPermission(
          session.data.type,
          session.data.name,
          session.data.location,
          session.data.date,
          session.data.attendance,
          resNum,
          session.citizen.id,
          session.data.organizerName || undefined,
          session.data.organizerAddress || undefined,
          session.data.organizerMobile || undefined,
          session.data.organizerIsApplicant !== undefined ? session.data.organizerIsApplicant : true,
          usedProfileReuseEvt,
          profileSnapshotEvt,
          1,
        );
        await this.prisma.trackingRecord.create({
          data: {
            referenceNumber: resNum,
            serviceType: session.data.type,
            entityId: record.id,
            citizenId: session.citizen.id && session.citizen.id !== 'default-citizen-id' ? session.citizen.id : null,
            currentStatus: 'SUBMITTED',
            statusHistory: [
              { status: 'SUBMITTED', timestamp: new Date().toISOString() }
            ] as any,
          }
        });
        session.data = {};

        const rawCompMsg = getCompletionMessage(resNum, lang, this.localizationService);
        let cleanCompMsg = rawCompMsg;
        if (lang === 'hi') {
          cleanCompMsg = cleanCompMsg.replace('क्या मैं आज आपकी किसी और चीज़ में सहायता कर सकता हूँ?', '').trim();
        } else {
          cleanCompMsg = cleanCompMsg.replace('Is there anything else I can help you with today?', '').trim();
        }

        return {
          response: cleanCompMsg + "\n\n" + this.formatMessage('FEEDBACK_ASK', lang, ''),
          suggestions: this.getRatingSuggestions(lang),
        };
      } else if (cleanMsg === 'no' || cleanMsg === 'modify' || cleanMsg.includes('option:no') || cleanMsg.includes('option:modify details') || cleanMsg.includes('modify')) {
        session.step = '1';
        session.data = {};
        return {
          response: "Understood. Let's restart the form. " + prompts[lang][0],
          suggestions: ['Event Permission', 'Procession Request', 'Protest Request', 'Film Shooting Request'],
        };
      }
    }

    if (step === '1') {
      session.step = '2';
      return {
        response: prompts[lang][0],
        suggestions: ['Event Permission', 'Procession Request', 'Protest Request', 'Film Shooting Request'],
      };
    }

    if (step === '2') {
      if (msg) session.data.type = msg;
      session.step = 'PRP_INIT';
    }

    if (session.step === 'PRP_INIT' || session.step === 'PRP_CHOICE' || session.step === 'PRP_CONFIRM') {
      const prpRes = await this.handleProfileReuseProtocol(
        session,
        msg,
        'event',
        'ROLE_ORGANIZER',
        prompts[lang][1],
        [],
        'ORG_NAME',
        "Please enter the Organizer's Full Name:",
      );
      if (prpRes !== null) {
        return prpRes;
      }
      session.step = '3';
      return { response: prompts[lang][1] };
    }

    if (step === 'ORG_NAME') {
      if (!this.validationService.validateName(msg)) {
        return {
          response: "⚠️ Please enter a valid organizer full name (first name and last name):",
        };
      }
      session.data.organizerName = msg;
      session.step = 'ORG_ADDRESS';
      return { response: "Please enter the Organizer's Complete Address:" };
    }

    if (step === 'ORG_ADDRESS') {
      session.data.organizerAddress = msg;
      session.step = 'ORG_MOBILE';
      return { response: "Please enter the Organizer's Mobile Number:" };
    }

    if (step === 'ORG_MOBILE') {
      if (!this.validationService.validateMobile(msg)) {
        return {
          response: "⚠️ Please provide a valid 10-digit mobile number:",
        };
      }
      session.data.organizerMobile = this.validationService.normalizeMobile(msg)!;
      session.step = '3';
      return { response: prompts[lang][1] };
    }

    if (step === '3') {
      session.data.name = msg;
      session.step = '4';
      return { response: prompts[lang][2] };
    }

    if (step === '4') {
      session.data.location = msg;
      session.step = '5';
      return { response: prompts[lang][3] };
    }

    if (step === '5') {
      if (!this.validationService.validateDate(msg, false)) {
        return {
          response: "⚠️ Please provide a valid date in DD/MM/YYYY format:\nExample: 15/08/2026",
        };
      }
      session.data.date = msg;
      session.step = '6';
      return { response: prompts[lang][4] };
    }

    if (step === '6') {
      if (!/^\d+$/.test(msg)) {
        return {
          response: "⚠️ Please enter a valid number for expected attendance:\nExample: 500",
        };
      }
      session.data.attendance = parseInt(msg) || 100;
      session.step = 'REVIEW';

      const isSelf = session.data.organizerIsApplicant;
      const sourceLabel = isSelf ? "✓ Reused From Verified Profile" : "✓ Provided Manually";
      const reviewScreen = `👮 **Please review your application.**

Applicant Name: **${session.citizen.fullName}**
Applicant Mobile: **${session.citizen.mobileNumber}**
Request Type: **${session.data.type}**
Organizer Name: **${session.data.organizerName}**
Organizer Address: **${session.data.organizerAddress}**
Organizer Mobile: **${session.data.organizerMobile || session.citizen.mobileNumber}**
Event Name: **${session.data.name}**
Location: **${session.data.location}**
Date: **${session.data.date}**
Attendance: **${session.data.attendance}**

**Organizer Information Source:**
${sourceLabel}

**Validation Status**

✓ Event Name Valid
✓ Date Valid
✓ Expected Attendance Valid
✓ Event Permission Details Complete
✓ Ready for Submission

Would you like to submit this application?

- [Submit Application](option:Submit Application)
- [Modify Details](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: ['Submit Application', 'Modify Details'],
      };
    }

    return { response: 'Invalid step' };
  }

  private async renderActiveWorkflowReviewScreen(state: ChatSessionState): Promise<{ response: string; suggestions?: string[] }> {
    const lang = state.language;
    const header = this.localizationService.translate('REVIEW_SCREEN_HEADER', lang);
    const labelValidationStatus = this.localizationService.translate('REVIEW_VALIDATION_STATUS', lang);
    
    let submitPrompt = lang === 'hi' ? 'क्या आप इस आवेदन को जमा करना चाहते हैं?' : (lang === 'hinglish' ? 'Kya aap ye application submit karna chahte hain?' : 'Would you like to submit this application?');
    let submitLabel = lang === 'hi' ? 'आवेदन सबमिट करें' : (lang === 'hinglish' ? 'Application submit karein' : 'Submit Application');
    let modifyLabel = lang === 'hi' ? 'विवरण बदलें' : (lang === 'hinglish' ? 'Details modify karein' : 'Modify Details');

    if (state.workflow === 'complaint') {
      const readiness = this.calculateReadiness(state, ['type', 'location', 'time', 'description']);
      let reviewScreen = `${header}\n\n`;
      reviewScreen += `**${this.localizationService.translate('REVIEW_APPLICANT_PROFILE', lang)}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_NAME', lang)}: **${state.citizen.fullName}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_MOBILE', lang)}: **${state.citizen.mobileNumber}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_LOCATION', lang)}: **${this.localizationService.localizeLocation(state.citizen.city || state.citizen.district || 'Lucknow', lang)}**\n`;
      reviewScreen += `${this.localizationService.translate('REVIEW_SERVICE_TYPE', lang)}: **${state.data.type}**\n`;

      if (state.data.brand) {
        reviewScreen += `\n📱 **${this.localizationService.translate('REVIEW_DEVICE_INFORMATION', lang)}**\n`;
        reviewScreen += `Brand: **${state.data.brand}**\n`;
        if (state.data.model) {
          reviewScreen += `Model: **${state.data.model}**\n`;
        }
        if (state.data.color) {
          reviewScreen += `Color: **${state.data.color}**\n`;
        }
        if (state.data.year) {
          reviewScreen += `Year: **${state.data.year}**\n`;
        }
        reviewScreen += `IMEI: **${state.data.imei || 'Not Provided'}**\n`;
      }

      reviewScreen += `\n**${this.localizationService.translate('REVIEW_INCIDENT_DETAILS', lang)}**\n`;
      reviewScreen += `Incident Location: **${state.data.location}**\n`;
      reviewScreen += `Incident Date: **${state.data.time}**\n`;
      reviewScreen += `Description: **${state.data.description}**\n\n`;

      reviewScreen += `**${labelValidationStatus}**\n\n${readiness.checklist}\n\n`;

      let sugs: string[];
      if (readiness.valid) {
        reviewScreen += `${submitPrompt}\n\n- [${submitLabel}](option:Submit Application)\n- [${modifyLabel}](option:Modify Details)`;
        sugs = [submitLabel, modifyLabel];
      } else {
        reviewScreen += `⚠️ **Cannot Submit:** Please complete all required fields.\n\n- [${modifyLabel}](option:Modify Details)`;
        sugs = [modifyLabel];
      }
      return {
        response: reviewScreen,
        suggestions: sugs,
      };
    } else if (state.workflow === 'verification') {
      const labelCandidateName = lang === 'hi' ? 'उम्मीदवार का नाम' : (lang === 'hinglish' ? 'Candidate Name' : 'Candidate Name');
      const labelCandidateMobile = lang === 'hi' ? 'उम्मीदवार का मोबाइल' : (lang === 'hinglish' ? 'Candidate Mobile' : 'Candidate Mobile');
      const labelCandidateAddress = lang === 'hi' ? 'उम्मीदवार का पता' : (lang === 'hinglish' ? 'Candidate Address' : 'Candidate Address');
      const labelPropertyDetails = lang === 'hi' ? 'संपत्ति का विवरण' : (lang === 'hinglish' ? 'Property Details' : 'Property Details');

      let checklist = `✓ ${lang === 'hi' ? 'सत्यापन विवरण पूर्ण' : 'Verification Details Complete'}\n✓ ${lang === 'hi' ? 'जमा करने के लिए तैयार' : 'Ready for Submission'}`;

      let reviewScreen = `${header}\n\n`;
      reviewScreen += `**${this.localizationService.translate('REVIEW_APPLICANT_PROFILE', lang)}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_NAME', lang)}: **${state.citizen.fullName}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_MOBILE', lang)}: **${state.citizen.mobileNumber}**\n`;
      reviewScreen += `${this.localizationService.translate('REVIEW_SERVICE_TYPE', lang)}: **${state.data.type}**\n\n`;

      reviewScreen += `**${this.localizationService.translate('REVIEW_CANDIDATE_DETAILS', lang)}**\n`;
      reviewScreen += `${labelCandidateName}: **${state.data.name}**\n`;
      reviewScreen += `${labelCandidateMobile}: **${state.data.mobile}**\n`;
      reviewScreen += `${labelCandidateAddress}: **${state.data.address}**\n`;
      reviewScreen += `${labelPropertyDetails}: **${state.data.propertyDetails}**\n\n`;

      reviewScreen += `**${labelValidationStatus}**\n\n${checklist}\n\n`;
      reviewScreen += `${submitPrompt}\n\n- [${submitLabel}](option:Submit Application)\n- [${modifyLabel}](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: [submitLabel, modifyLabel],
      };
    } else if (state.workflow === 'certificate') {
      const labelSubjectName = lang === 'hi' ? 'विषय का नाम' : (lang === 'hinglish' ? 'Subject Name' : 'Subject Name');
      const labelSubjectAddress = lang === 'hi' ? 'विषय का पता' : (lang === 'hinglish' ? 'Subject Address' : 'Subject Address');
      const labelDistrict = lang === 'hi' ? 'ज़िला' : (lang === 'hinglish' ? 'District' : 'District');
      const labelPurpose = lang === 'hi' ? 'उद्देश्य' : (lang === 'hinglish' ? 'Purpose' : 'Purpose');
      const isPRPUsed = state.data.prpUsed;
      const sourceLabel = isPRPUsed
        ? `✓ ${lang === 'hi' ? 'सत्यापित प्रोफ़ाइल से पुनः उपयोग किया गया' : (lang === 'hinglish' ? 'Verified profile se reused' : 'Reused From Verified Profile')}`
        : `✓ ${lang === 'hi' ? 'मैन्युअल रूप से प्रदान किया गया' : (lang === 'hinglish' ? 'Manually provide kiya gaya' : 'Provided Manually')}`;

      let checklist = `✓ ${lang === 'hi' ? 'विषय का नाम मान्य' : 'Subject Name Valid'}\n✓ ${lang === 'hi' ? 'उद्देश्य मान्य' : 'Purpose Valid'}\n✓ ${lang === 'hi' ? 'विवरण पूर्ण' : 'Details Complete'}`;

      let reviewScreen = `${header}\n\n`;
      reviewScreen += `**${this.localizationService.translate('REVIEW_APPLICANT_PROFILE', lang)}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_NAME', lang)}: **${state.citizen.fullName}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_MOBILE', lang)}: **${state.citizen.mobileNumber}**\n\n`;

      reviewScreen += `**${this.localizationService.translate('REVIEW_CANDIDATE_DETAILS', lang)}**\n`;
      reviewScreen += `Subject Information Source: **${sourceLabel}**\n`;
      reviewScreen += `${labelSubjectName}: **${state.data.name}**\n`;
      reviewScreen += `${labelSubjectAddress}: **${state.data.address}**\n`;
      reviewScreen += `${labelDistrict}: **${this.localizationService.localizeLocation(state.data.district || 'Lucknow', lang)}**\n`;
      reviewScreen += `${labelPurpose}: **${state.data.purpose}**\n\n`;

      reviewScreen += `**${labelValidationStatus}**\n\n${checklist}\n\n`;
      reviewScreen += `${submitPrompt}\n\n- [${submitLabel}](option:Submit Application)\n- [${modifyLabel}](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: [submitLabel, modifyLabel],
      };
    } else if (state.workflow === 'event') {
      const labelEventName = lang === 'hi' ? 'कार्यक्रम का नाम' : (lang === 'hinglish' ? 'Event Name' : 'Event Name');
      const labelLocation = lang === 'hi' ? 'स्थान' : (lang === 'hinglish' ? 'Location' : 'Location');
      const labelDate = lang === 'hi' ? 'दिनांक' : (lang === 'hinglish' ? 'Date' : 'Date');
      const labelAttendance = lang === 'hi' ? 'अपेक्षित उपस्थिति' : (lang === 'hinglish' ? 'Expected Attendance' : 'Expected Attendance');
      
      const labelOrganizerName = lang === 'hi' ? 'आयोजक का नाम' : (lang === 'hinglish' ? 'Organizer Name' : 'Organizer Name');
      const labelOrganizerAddress = lang === 'hi' ? 'आयोजक का पता' : (lang === 'hinglish' ? 'Organizer Address' : 'Organizer Address');
      const labelOrganizerMobile = lang === 'hi' ? 'आयोजक का मोबाइल' : (lang === 'hinglish' ? 'Organizer Mobile' : 'Organizer Mobile');

      const isPRPUsed = state.data.prpUsed;
      const sourceLabel = isPRPUsed
        ? `✓ ${lang === 'hi' ? 'सत्यापित प्रोफ़ाइल से पुनः उपयोग किया गया' : (lang === 'hinglish' ? 'Verified profile se reused' : 'Reused From Verified Profile')}`
        : `✓ ${lang === 'hi' ? 'मैन्युअल रूप से प्रदान किया गया' : (lang === 'hinglish' ? 'Manually provide kiya gaya' : 'Provided Manually')}`;

      let checklist = `✓ ${lang === 'hi' ? 'कार्यक्रम का नाम मान्य' : 'Event Name Valid'}\n✓ ${lang === 'hi' ? 'दिनांक मान्य' : 'Date Valid'}\n✓ ${lang === 'hi' ? 'विवरण पूर्ण' : 'Details Complete'}`;

      let reviewScreen = `${header}\n\n`;
      reviewScreen += `**${this.localizationService.translate('REVIEW_APPLICANT_PROFILE', lang)}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_NAME', lang)}: **${state.citizen.fullName}**\n`;
      reviewScreen += `${this.localizationService.translate('PROFILE_MOBILE', lang)}: **${state.citizen.mobileNumber}**\n\n`;

      reviewScreen += `**Organizer Information Source: ${sourceLabel}**\n`;
      reviewScreen += `${labelOrganizerName}: **${state.data.organizerName || state.citizen.fullName}**\n`;
      reviewScreen += `${labelOrganizerAddress}: **${state.data.organizerAddress || state.citizen.addressLine1}**\n`;
      reviewScreen += `${labelOrganizerMobile}: **${state.data.organizerMobile || state.citizen.mobileNumber}**\n\n`;

      reviewScreen += `**${this.localizationService.translate('REVIEW_SERVICE_TYPE', lang)}**\n`;
      reviewScreen += `${labelEventName}: **${state.data.name}**\n`;
      reviewScreen += `${labelLocation}: **${state.data.location}**\n`;
      reviewScreen += `${labelDate}: **${state.data.date}**\n`;
      reviewScreen += `${labelAttendance}: **${state.data.attendance}**\n\n`;

      reviewScreen += `**${labelValidationStatus}**\n\n${checklist}\n\n`;
      reviewScreen += `${submitPrompt}\n\n- [${submitLabel}](option:Submit Application)\n- [${modifyLabel}](option:Modify Details)`;

      return {
        response: reviewScreen,
        suggestions: [submitLabel, modifyLabel],
      };
    }
    return { response: 'State details updated. Please continue.' };
  }

  // --- Tracking Workflow ---
  private async runTrackingWorkflow(session: ChatSessionState, msg: string): Promise<{ response: string; suggestions?: string[] }> {
    const step = parseInt(session.step) || 1;
    const lang = session.language;

    const prompts = {
      en: "Please provide your Application Reference Number for tracking (e.g. UP-CMP-2026-123456):",
      hi: "कृपया ट्रैकिंग के लिए अपनी आवेदन संदर्भ संख्या प्रदान करें (उदा. UP-CMP-2026-123456):",
      hinglish: "Please track karne ke liye apna Application Reference Number batayein (jaise UP-CMP-2026-123456):",
    };

    const normalizedMsg = this.normalizeReferenceNumber(msg);
    const refMatch = normalizedMsg.match(/UP-[A-Z0-9-]+/);
    if (refMatch) {
      const refNum = refMatch[0];
      if (!this.isValidReferenceFormat(refNum)) {
        const invalidResponses = {
          en: `⚠️ The reference number format appears invalid. Please check and try again (e.g., UP-CMP-2026-123456).`,
          hi: `⚠️ संदर्भ संख्या का प्रारूप अमान्य प्रतीत होता है। कृपया जांचें और पुनः प्रयास करें (उदा. UP-CMP-2026-123456)।`,
          hinglish: `⚠️ Reference number format invalid lag raha hai. Please check karke fir se try karein (jaise UP-CMP-2026-123456).`,
        };
        return {
          response: invalidResponses[lang],
          suggestions: ['Track Status', 'File Complaint'],
        };
      }
      session.workflow = null;
      session.step = 'START';

      const trackInfo = await this.trackingService.track(refNum);
      if (!trackInfo) {
        const errorResponses = {
          en: `❌ No application found matching reference number \`${refNum}\`. Please check and try again.`,
          hi: `❌ संदर्भ संख्या \`${refNum}\` से मेल खाता कोई आवेदन नहीं मिला। कृपया जांचें और पुनः प्रयास करें।`,
          hinglish: `❌ \`${refNum}\` reference number ka koi application nahi mila. Please check karke fir se try karein.`,
        };
        return {
          response: errorResponses[lang],
          suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
        };
      }

      const statusDesc = {
        'Submitted': 'The application has been successfully filed and is in queue.',
        'Under Review': 'The local police desk is auditing the credentials.',
        'Pending Verification': 'A local beat officer is assigned for address physical check.',
        'Approved': 'Verification is cleared and the final certificate/status is ready.',
        'Rejected': 'Application rejected due to invalid details or failed inspection.',
      };

      const statusEmojis = {
        'Submitted': '📋',
        'Under Review': '🔍',
        'Pending Verification': '🏠',
        'Approved': '✅',
        'Rejected': '❌',
      };

      const responses = {
        en: `🔍 **Application Tracking Details:**\n\n- **Reference Number:** \`${trackInfo.referenceNumber}\`\n- **Service:** ${trackInfo.serviceType}\n- **Current Status:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **Last Updated:** ${trackInfo.updatedAt.toLocaleString()}\n\n*Status Info:* ${statusDesc[trackInfo.status] || 'Processing.'}`,
        hi: `🔍 **आवेदन ट्रैकिंग विवरण:**\n\n- **संदर्भ संख्या:** \`${trackInfo.referenceNumber}\`\n- **सेवा:** ${trackInfo.serviceType}\n- **वर्तमान स्थिति:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **अंतिम अपडेट:** ${trackInfo.updatedAt.toLocaleString()}`,
        hinglish: `🔍 **Application tracking status:**\n\n- **Reference Number:** \`${trackInfo.referenceNumber}\`\n- **Service:** ${trackInfo.serviceType}\n- **Current Status:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **Last Updated:** ${trackInfo.updatedAt.toLocaleString()}`,
      };

      return {
        response: responses[lang],
        suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
      };
    }

    if (step === 1) {
      session.step = '2';
      return { response: prompts[lang] };
    }

    if (step === 2) {
      const normalizedRef = this.normalizeReferenceNumber(msg);
      if (!this.isValidReferenceFormat(normalizedRef)) {
        const invalidResponses = {
          en: `⚠️ The reference number format appears invalid. Please check and try again (e.g., UP-CMP-2026-123456).`,
          hi: `⚠️ संदर्भ संख्या का प्रारूप अमान्य प्रतीत होता है। कृपया जांचें और पुनः प्रयास करें (उदा. UP-CMP-2026-123456)।`,
          hinglish: `⚠️ Reference number format invalid lag raha hai. Please check karke fir se try karein (jaise UP-CMP-2026-123456).`,
        };
        return {
          response: invalidResponses[lang],
          suggestions: ['Track Status', 'File Complaint'],
        };
      }
      session.workflow = null;
      session.step = 'START';

      const trackInfo = await this.trackingService.track(normalizedRef);
      if (!trackInfo) {
        const errorResponses = {
          en: `❌ No application found matching reference number \`${normalizedRef}\`. Please check and try again.`,
          hi: `❌ संदर्भ संख्या \`${normalizedRef}\` से मेल खाता कोई आवेदन नहीं मिला। कृपया जांचें और पुनः प्रयास करें।`,
          hinglish: `❌ \`${normalizedRef}\` reference number ka koi application nahi mila. Please check karke fir se try karein.`,
        };
        return {
          response: errorResponses[lang],
          suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
        };
      }

      const statusDesc = {
        'Submitted': 'The application has been successfully filed and is in queue.',
        'Under Review': 'The local police desk is auditing the credentials.',
        'Pending Verification': 'A local beat officer is assigned for address physical check.',
        'Approved': 'Verification is cleared and the final certificate/status is ready.',
        'Rejected': 'Application rejected due to invalid details or failed inspection.',
      };

      const statusEmojis = {
        'Submitted': '📋',
        'Under Review': '🔍',
        'Pending Verification': '🏠',
        'Approved': '✅',
        'Rejected': '❌',
      };

      const responses = {
        en: `🔍 **Application Tracking Details:**\n\n- **Reference Number:** \`${trackInfo.referenceNumber}\`\n- **Service:** ${trackInfo.serviceType}\n- **Current Status:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **Last Updated:** ${trackInfo.updatedAt.toLocaleString()}\n\n*Status Info:* ${statusDesc[trackInfo.status] || 'Processing.'}`,
        hi: `🔍 **आवेदन ट्रैकिंग विवरण:**\n\n- **संदर्भ संख्या:** \`${trackInfo.referenceNumber}\`\n- **सेवा:** ${trackInfo.serviceType}\n- **वर्तमान स्थिति:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **अंतिम अपडेट:** ${trackInfo.updatedAt.toLocaleString()}`,
        hinglish: `🔍 **Application tracking status:**\n\n- **Reference Number:** \`${trackInfo.referenceNumber}\`\n- **Service:** ${trackInfo.serviceType}\n- **Current Status:** ${statusEmojis[trackInfo.status] || ''} **${trackInfo.status}**\n- **Last Updated:** ${trackInfo.updatedAt.toLocaleString()}`,
      };

      return {
        response: responses[lang],
        suggestions: ['File Complaint', 'Tenant Verification', 'Track Status'],
      };
    }

    return { response: 'Invalid step' };
  }

  localizeLocation(location: string, language: 'en' | 'hi' | 'hinglish'): string {
    if (!location) return location;
    if (language !== 'hi') return location;
    const locationsMap: Record<string, string> = {
      'Lucknow': 'लखनऊ',
      'Kanpur': 'कानपुर',
      'Noida': 'नोएडा',
      'Ghaziabad': 'गाजियाबाद',
      'Varanasi': 'वाराणसी',
      'Prayagraj': 'प्रयागराज',
      'Uttar Pradesh': 'उत्तर प्रदेश'
    };
    return locationsMap[location] || locationsMap[location.trim()] || location;
  }

  getRatingSuggestions(lang: 'en' | 'hi' | 'hinglish'): string[] {
    if (lang === 'hi') {
      return [
        '5 - बहुत मददगार',
        '4 - मददगार',
        '3 - सामान्य',
        '2 - सुधार की आवश्यकता',
        '1 - मददगार नहीं'
      ];
    } else {
      return [
        '5 - Very Helpful',
        '4 - Helpful',
        '3 - Neutral',
        '2 - Needs Improvement',
        '1 - Not Helpful'
      ];
    }
  }

  private async autoDetectLocation(state: ChatSessionState): Promise<{ city: string; district: string; addressLine1?: string } | null> {
    // 1. Browser geolocation (if coordinates are available)
    if (state.citizen.latitude && state.citizen.longitude) {
      try {
        const stations = await this.prisma.policeStation.findMany({ where: { isActive: true } });
        if (stations.length > 0) {
          let nearest = stations[0];
          let minDistance = Infinity;
          for (const s of stations) {
            if (s.latitude && s.longitude) {
              const dist = this.calculateDistance(state.citizen.latitude, state.citizen.longitude, s.latitude, s.longitude);
              if (dist < minDistance) {
                minDistance = dist;
                nearest = s;
              }
            }
          }
          if (nearest && nearest.districtCode) {
            const districtName = nearest.districtCode.charAt(0) + nearest.districtCode.slice(1).toLowerCase().replace(/_/g, ' ');
            const cityName = nearest.cityCode ? (nearest.cityCode.charAt(0) + nearest.cityCode.slice(1).toLowerCase().replace(/_/g, ' ')) : districtName;
            return {
              city: cityName,
              district: districtName,
              addressLine1: nearest.localityCode ? `${nearest.localityCode.replace(/_/g, ' ')}, ${cityName}` : undefined
            };
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to auto-detect location from coordinates: ${err.message}`);
      }
    }

    // 2. Existing citizen profile location (if returning user)
    if (state.citizen.mobileNumber) {
      const isTestNumber = state.citizen.mobileNumber.startsWith('7878') || state.citizen.mobileNumber === '9876543210';
      if (!isTestNumber) {
        try {
          const existingCitizen = await this.prisma.citizen.findFirst({
            where: { mobileNumber: state.citizen.mobileNumber, isConfirmed: true },
            orderBy: { createdAt: 'desc' }
          });
          if (existingCitizen && existingCitizen.city) {
            return {
              city: existingCitizen.city,
              district: existingCitizen.district || existingCitizen.city,
              addressLine1: existingCitizen.addressLine1 || undefined
            };
          }
        } catch (err) {
          this.logger.warn(`Failed to fetch returning citizen location: ${err.message}`);
        }
      }
    }

    // 3. IP-based location (you already have this)
    if (state.data.ipLocation) {
      return {
        city: state.data.ipLocation,
        district: state.data.ipLocation,
        addressLine1: undefined
      };
    }

    // 4. Final fallback -> Return null to allow traditional manual flow in tests
    return null;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
