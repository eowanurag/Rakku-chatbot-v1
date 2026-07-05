import React from "react";
import DOMPurify from "dompurify";
import RakkuFloatingAssistant from "./RakkuFloatingAssistant";
import { ApplicantReviewCard, ServiceReviewCard, ValidationStatusCard } from "../review";

interface Message {
  role: "user" | "assistant";
  text: string;
  isStreaming?: boolean;
  avatarState?: string;
}

interface ChatMessageProps {
  msg: Message;
  idx: number;
  isLatestAssistant: boolean;
  onOptionClick: (value: string) => void;
  translate: (key: string) => string;
}

export default function ChatMessage({
  msg,
  idx,
  isLatestAssistant,
  onOptionClick,
  translate,
}: ChatMessageProps) {
  const isAssistant = msg.role === "assistant";

  // Check if this is a review message
  const textLower = msg.text.toLowerCase();
  const isReview = isAssistant && !msg.isStreaming && (
    textLower.includes("subject information source") || 
    textLower.includes("organizer information source")
  );

  let reviewUI = null;

  if (isReview) {
    const isEvent = textLower.includes("organizer information source") || textLower.includes("organizer name");
    
    // Determine profileSource
    let profileSource: 'VERIFIED_PROFILE' | 'MANUAL_ENTRY' = 'MANUAL_ENTRY';
    if (/reused|re-used|satyapit|सत्यापित|re-use/i.test(msg.text)) {
      profileSource = 'VERIFIED_PROFILE';
    }

    // Split text into Applicant and Service parts
    let applicantPart = msg.text;
    let servicePart = '';
    
    const splitKeywords = [
      "subject information source",
      "organizer information source",
      "review candidate details",
      "certificate request details",
      "event permission request details",
      "subject details",
      "service details"
    ];

    let splitIndex = -1;
    for (const kw of splitKeywords) {
      const idx = textLower.indexOf(kw);
      if (idx !== -1) {
        splitIndex = idx;
        break;
      }
    }

    if (splitIndex !== -1) {
      applicantPart = msg.text.substring(0, splitIndex);
      servicePart = msg.text.substring(splitIndex);
    }

    const parsePart = (partText: string) => {
      const res: Record<string, string> = {};
      const lines = partText.split('\n');
      lines.forEach(line => {
        const match = line.match(/(?:^|\s|•|-)\s*([^:\-\n]+?)\s*:\s*\*\*(.*?)\*\*/);
        if (match) {
          const key = match[1].replace(/^\*+\s*|\s*\*+$/g, '').trim().toLowerCase();
          const val = match[2].trim();
          res[key] = val;
        }
      });
      return res;
    };

    const applicantData = parsePart(applicantPart);
    const serviceData = parsePart(servicePart);

    const getVal = (data: Record<string, string>, keys: string[]) => {
      for (const k of keys) {
        if (data[k.toLowerCase()]) return data[k.toLowerCase()];
      }
      return '';
    };

    const applicantName = getVal(applicantData, ["applicant name", "name", "नाम"]);
    const applicantMobile = getVal(applicantData, ["applicant mobile", "mobile", "मोबाइल"]);
    const applicantLocation = getVal(applicantData, ["location", "district", "city", "स्थान", "जिला", "ज़िला"]);
    const applicantAddress = getVal(applicantData, ["address", "applicant address", "पता"]);

    if (isEvent) {
      const organizerName = getVal(serviceData, ["organizer name", "organizer name", "आयोजक का नाम"]) || getVal(applicantData, ["organizer name"]);
      const organizerAddress = getVal(serviceData, ["organizer address", "आयोजक का पता"]) || getVal(applicantData, ["organizer address"]) || applicantAddress;
      const organizerMobile = getVal(serviceData, ["organizer mobile", "आयोजक का मोबाइल"]) || getVal(applicantData, ["organizer mobile"]) || applicantMobile;
      const eventName = getVal(serviceData, ["event name", "name of your event", "कार्यक्रम का नाम"]);
      const eventLocation = getVal(serviceData, ["location", "event location", "event location/route", "स्थान"]);
      const eventDate = getVal(serviceData, ["date", "scheduled date", "दिनांक"]);
      const eventAttendance = getVal(serviceData, ["expected attendance", "attendance", "अपेक्षित उपस्थिति"]);

      reviewUI = (
        <div className="w-full flex flex-col space-y-4 my-2 text-slate-800" id="prp-review-container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ApplicantReviewCard
              name={organizerName || applicantName}
              mobile={organizerMobile || applicantMobile}
              location={applicantLocation}
              address={organizerAddress}
              profileSource={profileSource}
            />
            <ServiceReviewCard
              serviceName="Event Permission"
              details={{
                "Event Name": eventName,
                "Event Location": eventLocation,
                "Date": eventDate,
                "Expected Attendance": eventAttendance
              }}
              profileSource={profileSource}
            />
          </div>
          <ValidationStatusCard />
        </div>
      );
    } else {
      const subjectName = getVal(serviceData, ["subject name", "name", "विषय का नाम", "विषय नाम"]);
      const subjectAddress = getVal(serviceData, ["subject address", "address", "विषय का पता", "विषय पता"]);
      const subjectDistrict = getVal(serviceData, ["district", "applying district", "ज़िला", "जिला"]);
      const subjectPurpose = getVal(serviceData, ["purpose", "certificate purpose", "उद्देश्य"]);

      reviewUI = (
        <div className="w-full flex flex-col space-y-4 my-2 text-slate-800" id="prp-review-container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ApplicantReviewCard
              name={applicantName}
              mobile={applicantMobile}
              location={applicantLocation}
              address={applicantAddress}
              profileSource={profileSource}
            />
            <ServiceReviewCard
              serviceName="Character Certificate"
              details={{
                "Subject Name": subjectName,
                "Subject Address": subjectAddress,
                "District": subjectDistrict,
                "Purpose": subjectPurpose
              }}
              profileSource={profileSource}
            />
          </div>
          <ValidationStatusCard />
        </div>
      );
    }
  }

  // If it's the latest assistant message, render the floating active assistant
  if (isAssistant && isLatestAssistant) {
    return (
      <div className="w-full py-4 px-2 sm:px-4 bg-slate-950/20 border-y border-slate-900/40 rounded-3xl my-2">
        <RakkuFloatingAssistant
          state={msg.avatarState || "IDLE"}
          speechBubbleText={msg.text}
          onOptionClick={onOptionClick}
          showQuickActions={true}
        />
      </div>
    );
  }

  // Otherwise, render the standard conversational message bubble
  return (
    <div className={`flex ${isAssistant ? "justify-start" : "justify-end"} animate-fade-in-up`}>
      <div className={`flex items-start space-x-3 max-w-[85%] ${isAssistant ? "" : "flex-row-reverse space-x-reverse"}`}>
        {/* Avatar Icon */}
        {isAssistant ? (
          <img 
            src={
              msg.avatarState === "SALUTE" ? "/avatars/Salute Pose.png" :
              msg.avatarState === "WELCOME" ? "/avatars/welcome pose.png" :
              msg.avatarState === "NAMASTE" ? "/avatars/Namaste.png" :
              msg.avatarState === "IDLE" ? "/avatars/Ideal pose.png" :
              msg.avatarState === "THINKING" ? "/avatars/Thinking pose.png" :
              msg.avatarState === "TALKING" ? "/avatars/Taking pose.png" :
              msg.avatarState === "POINTING" ? "/avatars/pointing pose.png" :
              msg.avatarState === "COMPLETED" ? "/avatars/Completed.png" :
              msg.avatarState === "SUCCESS" ? "/avatars/success pose.png" :
              msg.avatarState === "EMERGENCY" ? "/avatars/Emergency pose.png" :
              msg.avatarState === "GOODBYE" ? "/avatars/Goodbye.png" :
              "/avatars/Ideal pose.png"
            } 
            alt="Rakku" 
            className="w-8 h-8 rounded-full object-cover object-top border border-police-gold/30 shadow flex-shrink-0 bg-slate-800" 
            onError={(e) => { (e.target as HTMLImageElement).src = '/rakku_officer.png'; }}
          />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shadow flex-shrink-0 bg-slate-800 text-slate-300">
            👤
          </div>
        )}

        {/* Text Bubble */}
        <div className={`rounded-2xl p-4 border text-xs sm:text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
          isAssistant 
            ? "bubble-assistant glow-gold/5" 
            : "bubble-user"
        }`}>
          {reviewUI ? (
            <>
              {reviewUI}
              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-800/80">
                <button
                  onClick={() => onOptionClick("Submit Application")}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
                >
                  Submit Application
                </button>
                <button
                  onClick={() => onOptionClick("Modify Details")}
                  className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer border border-slate-850"
                >
                  Modify Details
                </button>
              </div>
            </>
          ) : (
            (typeof window !== "undefined" ? DOMPurify.sanitize(msg.text) : msg.text).split("\n").map((line, lIdx) => {
              const isBullet = line.trim().startsWith("-") || line.trim().startsWith("👉") || line.trim().startsWith("•");

              // Parse markdown elements: **bold** and [label](url-or-option)
              const parseMarkdown = (text: string) => {
                const regex = /(\*\*.*?\*\*|\[.*?\]\(.*?\))/g;
                const elements = text.split(regex);
                
                return elements.map((part, index) => {
                  if (part.startsWith('**') && part.endsWith('**')) {
                    return (
                      <strong key={index} className="text-police-gold font-bold">
                        {part.slice(2, -2)}
                      </strong>
                    );
                  } else if (part.startsWith('[') && part.endsWith(')')) {
                    const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
                    if (linkMatch) {
                      const label = linkMatch[1];
                      const url = linkMatch[2];
                      if (url.startsWith('option:')) {
                        const optionVal = url.substring(7);
                        return (
                          <button
                            key={index}
                            onClick={() => onOptionClick(optionVal)}
                            className="text-police-gold hover:text-white underline font-semibold mx-1 cursor-pointer transition-colors text-left bg-transparent border-0 p-0 inline align-baseline"
                          >
                            {label}
                          </button>
                        );
                      } else {
                        return (
                          <a
                            key={index}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-police-gold hover:underline font-semibold mx-1 inline"
                          >
                            {label}
                          </a>
                        );
                      }
                    }
                  }
                  return part;
                });
              };

              return (
                <p 
                  key={lIdx} 
                  className={`${isBullet ? "pl-4 py-0.5" : ""} ${line.trim() === "" ? "h-3" : ""}`}
                >
                  {parseMarkdown(line)}
                </p>
              );
            })
          )}

          {/* If first message, show action buttons grid */}
          {isAssistant && idx === 0 && (
            <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-slate-800/80">
              <button
                onClick={() => onOptionClick(translate("SERVICE_NEAREST_STATION") === "नजदीकी थाना खोजें" ? "📍 नजदीकी थाना खोजें" : "nearest police station")}
                className="p-3 bg-slate-900/60 hover:bg-slate-850 border border-slate-800 hover:border-police-gold rounded-xl transition-all flex flex-col items-center justify-center text-center space-y-1.5 group cursor-pointer"
              >
                <span className="text-xl">📍</span>
                <span className="text-[11px] font-bold text-slate-300 group-hover:text-police-gold transition-colors">{translate("SERVICE_NEAREST_STATION")}</span>
              </button>
              
              <button
                onClick={() => onOptionClick(translate("SERVICE_EMERGENCY") === "आपातकालीन सहायता" ? "🆘 आपातकालीन सहायता" : "Emergency Help")}
                className="p-3 bg-slate-900/60 hover:bg-slate-850 border border-slate-800 hover:border-police-gold rounded-xl transition-all flex flex-col items-center justify-center text-center space-y-1.5 group cursor-pointer"
              >
                <span className="text-xl animate-pulse">🆘</span>
                <span className="text-[11px] font-bold text-slate-300 group-hover:text-police-gold transition-colors">{translate("SERVICE_EMERGENCY")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
