import random
import re
from datetime import datetime

def validate_name_confidence(name: str) -> tuple[bool, float]:
    if not name or len(name.strip()) < 2:
        return False, 0.0
    trimmed = name.strip()
    if re.match(r"^\d+$", trimmed):
        return False, 0.0
    if re.match(r"^[^a-zA-Z\u0900-\u097F\s'-]+$", trimmed):
        return False, 0.0
    # Obvious garbage checks
    if re.match(r"^[\s'-]+$", trimmed):
        return False, 0.0
    
    # Calculate confidence score
    # Lower confidence if name contains numbers or suspicious characters
    if re.search(r"[0-9@#$%^&*()_+={}\[\]|\\:;\"'<>,.?/~`]", trimmed):
        return True, 0.60
    return True, 0.99

def validate_name(name: str) -> bool:
    valid, _ = validate_name_confidence(name)
    return valid

def parse_full_address(text: str) -> dict:
    pincode_match = re.search(r"\b\d{6}\b", text)
    pincode = pincode_match.group(0) if pincode_match else None
    
    # Remove pincode from the text to prevent duplication in lines
    clean_text = text
    if pincode:
        clean_text = re.sub(r"\b" + pincode + r"\b", "", clean_text)
        # Remove trailing hyphens or extra commas left after removing pincode
        clean_text = re.sub(r"[\s,-]+$", "", clean_text)
        clean_text = re.sub(r"\s*,\s*,", ",", clean_text)
        clean_text = clean_text.strip()
        
    lines = [l.strip() for l in clean_text.split("\n") if l.strip()]
    if len(lines) >= 2:
        addressLine1 = lines[0]
        addressLine2 = ", ".join(lines[1:])
    else:
        parts = [p.strip() for p in clean_text.split(",") if p.strip()]
        if len(parts) >= 2:
            addressLine1 = parts[0]
            addressLine2 = ", ".join(parts[1:])
        else:
            addressLine1 = clean_text.strip()
            addressLine2 = None
            
    return {
        "addressLine1": addressLine1,
        "addressLine2": addressLine2,
        "pincode": pincode
    }

MESSAGE_LIBRARY = None

def classify_feedback(comments: str) -> str:
    if not comments:
        return "OTHER"
    text = comments.lower()
    if any(w in text for w in ['hindi', 'english', 'language', 'हिन्दी', 'हिंदी', 'अंग्रेजी', 'अनुवाद', 'translation', 'leakage', 'bhasha', 'बात करो']):
        return 'LOCALIZATION'
    if any(w in text for w in ['confusing', 'many questions', 'hard', 'difficult', 'understand', 'complex', 'swal', 'saval', 'सवाल']):
        return 'CONFUSING_FLOW'
    if any(w in text for w in ['location', 'district', 'city', 'area', 'sthan', 'zila', 'जिला', 'स्थान', 'गलत']):
        return 'LOCATION_ERROR'
    if any(w in text for w in ['track', 'status', 'reference', 'ref', 'number', 'no record', 'checking']):
        return 'TRACKING_ISSUE'
    if any(w in text for w in ['verify', 'verification', 'tenant', 'employee', 'domestic', 'satyapan', 'किरायेदार']):
        return 'VERIFICATION_ISSUE'
    if any(w in text for w in ['slow', 'response', 'time', 'lag', 'delay', 'wait', 'time limit']):
        return 'PERFORMANCE'
    if any(w in text for w in ['ui', 'interface', 'button', 'screen', 'display', 'color', 'font', 'layout']):
        return 'UI_PROBLEM'
    return 'OTHER'


def load_message_library():
    global MESSAGE_LIBRARY
    try:
        import json
        import os
        dir_path = os.path.dirname(os.path.abspath(__file__))
        filePathLocal = os.path.join(dir_path, 'message_library.json')
        filePathShared = os.path.abspath(os.path.join(dir_path, '..', 'shared', 'message_library.json'))
        filePath = filePathLocal if os.path.exists(filePathLocal) else filePathShared
        if os.path.exists(filePath):
            with open(filePath, 'r', encoding='utf-8') as f:
                MESSAGE_LIBRARY = json.load(f)
                print(f"[LOAD] Loaded Message Library v{MESSAGE_LIBRARY.get('version')} from {filePath}")
        else:
            print(f"[ERROR] Message library file not found. Tried {filePathLocal} and {filePathShared}")
    except Exception as e:
        print(f"[ERROR] Failed to load message library: {e}")

load_message_library()

def format_message(key: str, lang: str, session, params: dict = None, db_action_list: list = None) -> str:
    global MESSAGE_LIBRARY
    if not MESSAGE_LIBRARY:
        load_message_library()
    
    messages = MESSAGE_LIBRARY.get("messages", {}) if MESSAGE_LIBRARY else {}
    msg_obj = messages.get(key)
    
    template = ""
    final_lang = lang
    
    if not msg_obj:
        log_missing_message(key, lang, session, db_action_list)
        return key
        
    if lang in msg_obj and msg_obj[lang].strip() != "":
        template = msg_obj[lang]
    else:
        log_missing_message(key, lang, session, db_action_list)
        if lang == "hi":
            if "hinglish" in msg_obj and msg_obj["hinglish"].strip() != "":
                template = msg_obj["hinglish"]
                final_lang = "hinglish"
            elif "en" in msg_obj and msg_obj["en"].strip() != "":
                template = msg_obj["en"]
                final_lang = "en"
        elif lang == "hinglish":
            if "en" in msg_obj and msg_obj["en"].strip() != "":
                template = msg_obj["en"]
                final_lang = "en"
                
    if not template and "en" in msg_obj:
        template = msg_obj["en"]
        
    if not template:
        for k in msg_obj.keys():
            if msg_obj[k] and msg_obj[k].strip() != "":
                template = msg_obj[k]
                break
        if not template:
            return key
            
    formatted = template
    if params:
        for k, v in params.items():
            formatted = formatted.replace(f"{{{k}}}", str(v if v is not None else ""))
            
    return formatted

def log_missing_message(key: str, language: str, session, db_action_list: list = None):
    db_action = {
        "type": "audit_log",
        "data": {
            "sessionId": session.citizenId or "unknown",
            "eventType": "MISSING_MESSAGE",
            "eventData": {
                "key": key,
                "language": language
            }
        }
    }
    if db_action_list is not None:
        db_action_list.append(db_action)

def log_audit(session, event_type: str, event_data: dict, db_action_list: list = None):
    timestamp = datetime.now().isoformat()
    import json
    log_line = json.dumps({
        "timestamp": timestamp,
        "sessionId": session.citizenId or "unknown",
        "eventType": event_type,
        "eventData": event_data
    })
    try:
        with open("rakku_audit.log", "a", encoding="utf-8") as f:
            f.write(log_line + "\n")
    except Exception as e:
        print(f"Failed to write audit log file: {e}")
        
    db_action = {
        "type": "audit_log",
        "data": {
            "sessionId": session.citizenId or "unknown",
            "eventType": event_type,
            "eventData": event_data
        }
    }
    if db_action_list is not None:
        db_action_list.append(db_action)

def extract_location(text: str) -> str | None:
    if not text:
        return None
    # 1. Regex patterns for locations in English and Hindi/Hinglish
    patterns = [
        r"(?:change location to|change my location to|location to)\s+([a-zA-Z\u0900-\u097F\s'-]+)",
        r"(?:live in|living in|resident of)\s+([a-zA-Z\u0900-\u097F\s'-]+)",
        r"(?:my district is|district is)\s+([a-zA-Z\u0900-\u097F\s'-]+)",
        r"(?:location is)\s+([a-zA-Z\u0900-\u097F\s'-]+)",
        r"([a-zA-Z\u0900-\u097F]+)\s+(?:me\s+rehta|me\s+rehti|mein\s+rehta|mein\s+rehti|me\s+rahta|me\s+rahti)",
        r"([a-zA-Z\u0900-\u097F]+)\s*(?:में रहता|में रहती|मे रहता|मे रहती)"
    ]
    
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            loc = match.group(1).strip()
            loc = re.sub(r"[।?!.,]$", "", loc).strip()
            if loc:
                return loc.capitalize()
                
    # 2. Known cities in UP fallback extraction:
    up_cities = ["lucknow", "kanpur", "noida", "ghaziabad", "varanasi", "prayagraj", "agra", "meerut", "bareilly", "aligarh", "moradabad", "saharanpur", "gorakhpur", "ayodhya", "jhansi", "muzaffarnagar", "mathura", "firozabad", "mirzapur", "lakhimpur", "hapur", "amroha", "noida", "greater noida"]
    words = re.findall(r"\b[a-zA-Z]+\b", text.lower())
    for w in words:
        if w in up_cities:
            return w.capitalize()
            
    hindi_cities = {
        "लखनऊ": "Lucknow", "कानपुर": "Kanpur", "नोएडा": "Noida", "गाजियाबाद": "Ghaziabad",
        "वाराणसी": "Varanasi", "प्रयागराज": "Prayagraj", "आगरा": "Agra", "गोरखपुर": "Gorakhpur"
    }
    for k, v in hindi_cities.items():
        if k in text:
            return v
            
    return None

def normalize_mobile(mobile: str) -> str | None:
    if not mobile:
        return None
    clean = re.sub(r"\s+", "", mobile)
    clean = re.sub(r"[-()]", "", clean)
    if clean.startswith("+91") and len(clean) == 13:
        clean = clean[3:]
    elif clean.startswith("91") and len(clean) == 12:
        clean = clean[2:]
    elif clean.startswith("0") and len(clean) == 11:
        clean = clean[1:]
    if re.match(r"^\d{10}$", clean):
        return clean
    return None

def validate_mobile(mobile: str) -> bool:
    norm = normalize_mobile(mobile)
    if not norm:
        return False
    return bool(re.match(r"^[6-9]\d{9}$", norm))

def validate_date(date_str: str, reject_future=True) -> bool:
    if not date_str:
        return False
    trimmed = date_str.strip()
    
    # 1. Try simple numeric format: DD/MM/YYYY or DD-MM-YYYY
    numeric_match = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", trimmed)
    if numeric_match:
        day, month, year = int(numeric_match.group(1)), int(numeric_match.group(2)), int(numeric_match.group(3))
    else:
        # 2. Try Hindi/English named month format: e.g. "6 जून 2026", "06 जून 2026", "6 June 2026"
        word_match = re.match(r"^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})$", trimmed)
        if not word_match:
            return False
        day = int(word_match.group(1))
        month_name = word_match.group(2).strip()
        year = int(word_match.group(3))
        
        hindi_months = {
            'जनवरी': 1, 'जन': 1, 'jan': 1, 'january': 1,
            'फरवरी': 2, 'फर': 2, 'feb': 2, 'february': 2,
            'मार्च': 3, 'mar': 3, 'march': 3,
            'अप्रैल': 4, 'अप्रै': 4, 'apr': 4, 'april': 4,
            'मई': 5, 'may': 5,
            'जून': 6, 'jun': 6, 'june': 6,
            'जुलाई': 7, 'जुला': 7, 'jul': 7, 'july': 7,
            'अगस्त': 8, 'अग': 8, 'aug': 8, 'august': 8,
            'सितंबर': 9, 'सितम्बर': 9, 'सित': 9, 'sep': 9, 'september': 9,
            'अक्टूबर': 10, 'अक्तूबर': 10, 'अक्तू': 10, 'ऑक्टोबर': 10, 'oct': 10, 'october': 10,
            'नवंबर': 11, 'नवम्बर': 11, 'नव': 11, 'nov': 11, 'november': 11,
            'दिसंबर': 12, 'दिसम्बर': 12, 'दिस': 12, 'dec': 12, 'december': 12
        }
        month = hindi_months.get(month_name) or hindi_months.get(month_name.lower())
        if not month:
            return False
            
    if month < 1 or month > 12:
        return False
    if day < 1 or day > 31:
        return False
    if month in [4, 6, 9, 11] and day > 30:
        return False
    if month == 2:
        is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
        if day > (29 if is_leap else 28):
            return False
    if reject_future:
        try:
            parsed = datetime(year, month, day)
            if parsed > datetime.now():
                return False
        except:
            return False
    else:
        try:
            datetime(year, month, day)
        except:
            return False
    return True

def localize_location(loc: str, lang: str) -> str:
    if not loc:
        return loc
    if lang != "hi":
        return loc
    locations_map = {
        "Lucknow": "लखनऊ",
        "Kanpur": "कानपुर",
        "Noida": "नोएडा",
        "Ghaziabad": "गाजियाबाद",
        "Varanasi": "वाराणसी",
        "Prayagraj": "प्रयागराज",
        "Uttar Pradesh": "उत्तर प्रदेश"
    }
    return locations_map.get(loc) or locations_map.get(loc.strip()) or loc

def validate_consistency(city: str, text: str) -> bool:
    if not city or not text:
        return True
    city_lower = city.lower().strip()
    text_lower = text.lower()
    major_cities = ["lucknow", "kanpur", "noida", "ghaziabad", "varanasi", "prayagraj", "agra", "delhi", "mumbai"]
    for other in major_cities:
        if other != city_lower and other in text_lower:
            return False
    return True


def format_name_with_honorific(name: str, lang: str) -> str:
    if not name:
        return ""
    if lang == "hi":
        if not name.endswith(" जी"):
            return f"{name} जी"
    return name


class WorkflowSession:
    def __init__(self):
        self.workflow = None  # 'complaint', 'verification', 'certificate', 'event', 'tracking'
        self.step = 0
        self.data = {}
        self.language = "en"  # "en", "hi", "hinglish"
        self.language_selected = False
        
        # Citizen Profile Fields
        self.citizenId = None
        self.fullName = ""
        self.mobileNumber = ""
        self.email = ""
        
        # Structured location & address
        self.area = ""
        self.city = ""
        self.district = ""
        self.state_name = "Uttar Pradesh"
        self.pincode = ""
        self.addressLine1 = ""
        self.addressLine2 = ""
        
        self.latitude = None
        self.longitude = None
        
        self.currentWorkflowState = "START"  # PROFILE_COLLECTION, PROFILE_CONFIRMATION, PROFILE_VERIFIED, SERVICE_COLLECTION, APPLICATION_REVIEW, APPLICATION_SUBMITTED, APPLICATION_MODIFICATION
        self.serviceType = None
        self.applicationData = {}
        self.referenceNumber = ""
        self.isConfirmed = False
        self.profileConfirmed = False
        self.applicationConfirmed = False
        self.currentExpectedField = ""

    def to_dict(self) -> dict:
        return {
            "workflow": self.workflow,
            "step": str(self.step),
            "currentWorkflowState": self.currentWorkflowState,
            "serviceType": self.serviceType,
            "applicationData": self.applicationData,
            "referenceNumber": self.referenceNumber,
            "data": self.data,
            "language": self.language,
            "languageSelected": self.language_selected,
            "profileConfirmed": self.profileConfirmed,
            "applicationConfirmed": self.applicationConfirmed,
            "currentExpectedField": self.currentExpectedField,
            "citizen": {
                "id": self.citizenId,
                "fullName": self.fullName,
                "mobileNumber": self.mobileNumber,
                "email": self.email,
                "city": self.city,
                "district": self.district,
                "state": self.state_name,
                "area": self.area,
                "pincode": self.pincode,
                "addressLine1": self.addressLine1,
                "addressLine2": self.addressLine2,
                "latitude": self.latitude,
                "longitude": self.longitude,
                "isConfirmed": self.isConfirmed,
            }
        }

    def from_dict(self, d: dict):
        if not d:
            return
        self.workflow = d.get("workflow")
        step_val = d.get("step", 0)
        self.currentWorkflowState = d.get("currentWorkflowState", "START")
        self.serviceType = d.get("serviceType", self.workflow)
        self.applicationData = d.get("applicationData", {})
        self.referenceNumber = d.get("referenceNumber", "")
        
        valid_steps = [
            'REVIEW', 'MODIFY_SELECT', 'MODIFY_INPUT', 'CONFIRM_AUTO_LOCATION', 
            'CONFIRM_NAME', 'IDENTIFY_ADDRESS', 'MODIFY_PROFILE_SELECT', 'MODIFY_PROFILE_INPUT'
        ]
        try:
            self.step = int(step_val) if str(step_val).isdigit() or step_val in valid_steps else step_val
        except:
            self.step = step_val
        self.data = d.get("data", {})
        self.language = d.get("language", "en")
        self.language_selected = d.get("languageSelected", False)
        self.profileConfirmed = d.get("profileConfirmed", False)
        self.applicationConfirmed = d.get("applicationConfirmed", False)
        self.currentExpectedField = d.get("currentExpectedField", "")
        
        cit = d.get("citizen", {})
        self.citizenId = cit.get("id")
        self.fullName = cit.get("fullName", "")
        self.mobileNumber = cit.get("mobileNumber", "")
        self.email = cit.get("email", "")
        self.city = cit.get("city", "")
        self.district = cit.get("district", "")
        self.state_name = cit.get("state", "Uttar Pradesh")
        self.area = cit.get("area", "")
        self.pincode = cit.get("pincode", "")
        self.addressLine1 = cit.get("addressLine1", "")
        self.addressLine2 = cit.get("addressLine2", "")
        self.latitude = cit.get("latitude")
        self.longitude = cit.get("longitude")
        self.isConfirmed = cit.get("isConfirmed", False)


class WorkflowEngine:
    def __init__(self):
        self.sessions = {}
        
        # Define fields to collect for each workflow
        self.workflow_fields = {
            "complaint": [
                {"name": "complaint_type", "label": "Complaint Type / शिकायत का प्रकार", "suggestions": ["Lost Mobile / Theft", "Lost Document", "Simple Harassment", "Cyber Fraud / Financial Loss"]},
                {"name": "incident_location", "label": "Incident Location / घटना का स्थान", "suggestions": []},
                {"name": "incident_time", "label": "Incident Date (DD/MM/YYYY) / घटना का दिनांक", "suggestions": []},
                {"name": "incident_description", "label": "Incident Description / घटना का विवरण", "suggestions": []}
            ],
            "verification": [
                {"name": "verification_type", "label": "Verification Type / सत्यापन का प्रकार", "suggestions": ["Tenant Verification", "PG Verification", "Domestic Help Verification", "Employee Verification"]},
                {"name": "name", "label": "Candidate Full Name / उम्मीदवार का पूरा नाम", "suggestions": []},
                {"name": "address", "label": "Permanent Address / स्थायी पता", "suggestions": []},
                {"name": "mobile", "label": "Mobile Number / मोबाइल नंबर", "suggestions": []},
                {"name": "property_details", "label": "Property Details (flat number, block, city) / संपत्ति का विवरण", "suggestions": []}
            ],
            "certificate": [
                {"name": "name", "label": "Full Name / पूरा नाम", "suggestions": []},
                {"name": "address", "label": "Permanent Address / स्थायी पता", "suggestions": []},
                {"name": "district", "label": "District in Uttar Pradesh / उत्तर प्रदेश का ज़िला", "suggestions": ["Lucknow", "Kanpur", "Noida", "Ghaziabad", "Varanasi", "Prayagraj"]},
                {"name": "purpose", "label": "Purpose of the Certificate / प्रमाण पत्र का उद्देश्य", "suggestions": ["Job Application", "Passport", "Visa", "Higher Education", "Government Service"]}
            ],
            "event": [
                {"name": "event_type", "label": "Request Type / अनुरोध का प्रकार", "suggestions": ["Event Permission", "Procession Request", "Protest Request", "Film Shooting Request"]},
                {"name": "event_name", "label": "Event Name / कार्यक्रम का नाम", "suggestions": []},
                {"name": "location", "label": "Location or Route / स्थान या मार्ग", "suggestions": []},
                {"name": "date", "label": "Date (DD/MM/YYYY) / तिथि", "suggestions": []},
                {"name": "expected_attendance", "label": "Expected Attendance / संभावित उपस्थिति संख्या", "suggestions": []}
            ],
            "tracking": [
                {"name": "reference_number", "label": "Application Reference Number / आवेदन संदर्भ संख्या (e.g. UP-CMP-2026-123456)", "suggestions": []}
            ]
        }

    def get_workflow_fields(self, session: WorkflowSession) -> list[dict]:
        fields = list(self.workflow_fields.get(session.workflow, []))
        if session.workflow == "complaint" and session.data.get("complaint_type") in ["Lost Mobile / Theft", "LOST_MOBILE"]:
            extended_fields = [
                {"name": "mobile_brand", "label": "Mobile Brand / मोबाइल ब्रांड", "suggestions": ["Samsung", "Apple", "Xiaomi", "Realme", "OnePlus", "Vivo", "Oppo"]},
                {"name": "mobile_model", "label": "Mobile Model / मोबाइल मॉडल", "suggestions": []},
                {"name": "mobile_color", "label": "Mobile Color / मोबाइल का रंग", "suggestions": []},
                {"name": "purchase_year", "label": "Purchase Year / खरीद का वर्ष (e.g. 2024)", "suggestions": []},
                {"name": "imei_number", "label": "IMEI Number (optional) / आईएमईआई नंबर (वैकल्पिक)", "suggestions": ["Skip / छोड़ें"]}
            ]
            if len(fields) > 0:
                new_fields = [fields[0]] + extended_fields + fields[1:]
                return new_fields
        return fields


    def get_session(self, session_id: str) -> WorkflowSession:
        if session_id not in self.sessions:
            self.sessions[session_id] = WorkflowSession()
        return self.sessions[session_id]

    def load_or_create_session(self, session_id: str, state_dict: dict | None) -> WorkflowSession:
        session = self.get_session(session_id)
        if state_dict:
            session.from_dict(state_dict)
        return session

    def check_emergency(self, text: str) -> bool:
        clean_text = text.lower()
        emergency_words = [
            "danger", "assault", "threat", "life", "weapon", "murder", "burglar", "attack", "emergency", 
            "killing", "ongoing crime", "stolen vehicle", "fire", "accident", "मदद", "खतरा", "हमला", "आग",
            "ongoing attack", "kidnapping", "burglary in progress", "immediate danger", "violence",
            "suicide", "self-harm", "injured", "अपहरण", "हत्या", "हिंसा", "धमकी", "आत्महत्या", "दुर्घटना", "घायल",
            "attacking me", "someone is attacking", "attacking me right now", "आपातकालीन", "सहायता",
            "emergency help", "emergency contacts", "आपातकालीन सहायता"
        ]
        return any(word in clean_text for word in emergency_words)

    def detect_language(self, text: str) -> str:
        clean = text.lower()
        if re.search(r'[\u0900-\u097F]', clean) or any(w in clean for w in ["hindi", "हिन्दी", "हिंदी", "किये", "रहा"]):
            return "hi"
        elif any(w in clean for w in ["karna hai", "karna", "chahiye", "hai", "chori", "gum", "kho", "shikayat"]):
            return "hinglish"
        return "en"

    def get_empathy_message(self, message: str, lang: str) -> str:
        clean_msg = message.lower()
        is_theft = any(w in clean_msg for w in ['stolen', 'theft', 'steal', 'chori', 'चोरी', 'चोर'])
        is_lost = any(w in clean_msg for w in ['lost', 'missing', 'gum', 'kho', 'खोया', 'खो', 'गुम'])
        is_harassment = any(w in clean_msg for w in ['harass', 'harassment', 'teasing', 'threat', 'trolling', 'pareshan', 'dhamki', 'उत्पीड़न', 'परेशान', 'धमकी'])
        is_fraud = any(w in clean_msg for w in ['fraud', 'scam', 'cheated', 'dhokha', 'cyber', 'धोखा', 'धोखाधड़ी', 'साइबर'])
        is_distress = any(w in clean_msg for w in ['distress', 'trouble', 'scared', 'worried', 'stressed', 'afraid', 'upset', 'तनाव', 'परेशान'])

        item_en, item_hi, item_hinglish = "property", "सामान", "property"
        if any(w in clean_msg for w in ['phone', 'mobile', 'device', 'फ़ोन', 'मोबाइल', 'फोन']):
            item_en, item_hi, item_hinglish = "phone", "मोबाइल", "phone"
        elif any(w in clean_msg for w in ['wallet', 'purse', 'money', 'cash', 'बटुआ', 'पर्स']):
            item_en, item_hi, item_hinglish = "wallet", "बटुआ / पर्स", "wallet"
        elif any(w in clean_msg for w in ['document', 'passport', 'card', 'aadhar', 'pan', 'दस्तावेज़']):
            item_en, item_hi, item_hinglish = "document", "दस्तावेज़", "document"

        if is_theft:
            services_info = {
                "en": "\n\n*Recommended Services:*\n- [🚔 File Complaint](option:🚔 File a Complaint)\n- [📱 Lost Article Report](option:Lost Article Report)\n- [📍 Nearest Police Station](option:nearest police station)\n\n",
                "hi": "\n\n*अनुशंसित सेवाएं:*\n- [🚔 शिकायत दर्ज करें](option:🚔 File a Complaint)\n- [📱 खोई हुई वस्तु रिपोर्ट](option:Lost Article Report)\n- [📍 निकटतम पुलिस स्टेशन](option:nearest police station)\n\n",
                "hinglish": "\n\n*Recommended Services:*\n- [🚔 File Complaint](option:🚔 File a Complaint)\n- [📱 Lost Article Report](option:Lost Article Report)\n- [📍 Nearest Police Station](option:nearest police station)\n\n"
            }
            if lang == "en":
                return f"I'm sorry to hear that your {item_en} was stolen.{services_info['en']}I'll help guide you through the complaint process.\n\n"
            elif lang == "hi":
                return f"मुझे यह सुनकर दुख हुआ कि आपका {item_hi} चोरी हो गया है।{services_info['hi']}मैं शिकायत प्रक्रिया में आपका मार्गदर्शन करूँगा।\n\n"
            else:
                return f"I'm sorry to hear that aapka {item_hinglish} chori ho gaya hai.{services_info['hinglish']}Main complaint process mein aapki madad karunga.\n\n"
        return ""

    def check_smart_helpline(self, message: str, lang: str) -> dict | None:
        clean = message.lower()
        if any(w in clean for w in ["scam", "scammed", "fraud", "cheated", "धोखा", "धोखाधड़ी", "साइबर", "fraud online", "online scam"]):
            response_msgs = {
                "en": "I'm sorry this happened.\n\nYou should immediately contact:\n\n📞 **Cyber Crime Helpline:** **1930**\n\nWould you also like guidance on filing a complaint?",
                "hi": "मुझे खेद है कि ऐसा हुआ।\n\nआपको तुरंत संपर्क करना चाहिए:\n\n📞 **साइबर अपराध हेल्पलाइन:** **1930**\n\nक्या आप शिकायत दर्ज करने के लिए मार्गदर्शन भी चाहते हैं?",
                "hinglish": "I'm sorry this happened.\n\nAapko immediately contact karna chahiye:\n\n📞 **Cyber Crime Helpline:** **1930**\n\nKya aap complaint file karne ke liye guidance chahte hain?"
            }
            return {
                "intercepted": True,
                "response": response_msgs[lang],
                "suggestions": ["File Complaint", "Nearest Police Station", "Emergency Contacts"]
            }
        return None

    def handle_profile_correction(self, session: WorkflowSession, message: str) -> bool:
        clean_msg = message.strip().lower()

        # Mobile correction
        phone_matches = re.findall(r"(?:mobile|number|phone|change mobile to|change number to)\s+(?:is\s+)?((?:\+91[\s-]?)?[6-9]\d{9}|\b[6-9]\d{9}\b)", message, re.IGNORECASE)
        if phone_matches:
            norm = normalize_mobile(phone_matches[0])
            if norm and validate_mobile(norm):
                session.mobileNumber = norm
                return True

        # Name correction
        name_matches = re.search(r"(?:name is|change name to|my name is)\s+([a-zA-Z\s'-]+)", message, re.IGNORECASE)
        if name_matches and name_matches.group(1):
            potential_name = name_matches.group(1).strip()
            if validate_name(potential_name):
                session.fullName = potential_name
                return True

        # Location correction
        loc_matches = re.search(r"(?:live in|change location to|change my location to)\s+([a-zA-Z\s'-]+)", message, re.IGNORECASE)
        if loc_matches and loc_matches.group(1):
            potential_loc = loc_matches.group(1).strip()
            if len(potential_loc) >= 3:
                session.city = potential_loc
                session.district = potential_loc
                return True

        return False

    def render_confirmation_card(self, session: WorkflowSession) -> dict:
        address_display = f"{session.addressLine1}"
        if session.addressLine2:
            address_display += f", {session.addressLine2}"
        if session.pincode:
            address_display += f" - {session.pincode}"
            
        district_val = localize_location(session.city or session.district or 'Lucknow', session.language)
        
        address_fallback = "Not provided"
        if session.language == "hi":
            address_fallback = "प्रदान नहीं किया गया"
        elif session.language == "hinglish":
            address_fallback = "Not provided"

        confirm_card = format_message(
            "PROFILE_CONFIRM_SCREEN", 
            session.language, 
            session, 
            {
                "name": session.fullName,
                "mobile": session.mobileNumber,
                "district": district_val,
                "address": address_display or address_fallback
            }
        )
        
        confirm_sug = "Confirm Details"
        modify_sug = "Modify Details"
        if session.language == "hi":
            confirm_sug = "विवरण की पुष्टि करें"
            modify_sug = "विवरण बदलें"
        elif session.language == "hinglish":
            confirm_sug = "Confirm Details"
            modify_sug = "Modify Details"

        return {
            "intercepted": True,
            "response": confirm_card,
            "suggestions": [confirm_sug, modify_sug]
        }

    def process_message(self, message: str, session_id: str, gemini_client=None) -> dict:
        session = self.get_session(session_id)
        clean_msg = message.strip().lower()

        # Emergency check
        if self.check_emergency(message):
            session.workflow = None
            session.step = 0
            session.data = {}
            lang = session.language
            return {
                "intercepted": True,
                "response": "⚠️ **EMERGENCY NOTICE:** This appears to be an emergency. Please contact UP Police emergency services immediately by dialing **112**.",
                "suggestions": ["File Complaint", "Track Status"]
            }

        # Check frustration first
        if message:
            frustration_key = None
            if any(w in clean_msg for w in ['why do you need', 'why this', 'why is it required', 'why is this required', 'why needed', 'what will you do with']):
                frustration_key = 'FRUSTRATION_WHY_NEEDED'
            elif any(w in clean_msg for w in ["don't know", "dont know", "not sure", "no idea", "i do not know", "i dont know"]):
                frustration_key = 'FRUSTRATION_DONT_KNOW'
            elif any(w in clean_msg for w in ['already told', 'already given', 'already provided', 'said before', 'already shared']):
                frustration_key = 'FRUSTRATION_ALREADY_TOLD'
            elif any(w in clean_msg for w in ['explain', 'what is this', 'what does this mean', 'what is']):
                frustration_key = 'FRUSTRATION_EXPLAIN_TERM'

            if frustration_key:
                db_action_list = []
                frust_text = format_message(frustration_key, session.language, session, db_action_list=db_action_list)
                # Re-prompt based on current step
                reprompt_res = self.process_message("", session_id, gemini_client)
                reprompt_text = reprompt_res.get("response", "")
                # If there are db actions from the inner process_message, propagate them
                if reprompt_res.get("db_action"):
                    db_action_list.extend(reprompt_res.get("db_action"))
                return {
                    "intercepted": True,
                    "response": f"{frust_text}\n\n{reprompt_text}",
                    "suggestions": reprompt_res.get("suggestions", []),
                    "db_action": db_action_list
                }

        # Check if language is selected yet
        if not getattr(session, "language_selected", False):
            matched_lang = False
            if "english" in clean_msg or "option:english" in clean_msg:
                session.language = "en"
                session.language_selected = True
                matched_lang = True
            elif any(w in clean_msg for w in ["हिंदी", "hindi", "हिन्दी"]) or "option:हिंदी" in clean_msg or "option:हिंदी (hindi)" in clean_msg:
                session.language = "hi"
                session.language_selected = True
                matched_lang = True
            elif "hinglish" in clean_msg or "option:hinglish" in clean_msg:
                session.language = "hinglish"
                session.language_selected = True
                matched_lang = True

            if matched_lang:
                return {
                    "intercepted": True,
                    "response": format_message("MAIN_MENU_GREETING", session.language, session),
                    "suggestions": ["File Complaint", "Tenant Verification", "Character Certificate", "Event Permission", "Track Application"]
                }
            
            starts_workflow = self.detect_workflow_intent(clean_msg)
            if starts_workflow:
                session.language = self.detect_language(clean_msg)
                session.language_selected = True
            else:
                welcome_msg = format_message("GREETING_LANGUAGE_SELECT", "en", session)
                return {
                    "intercepted": True,
                    "response": welcome_msg,
                    "suggestions": ["English", "हिंदी", "Hinglish"]
                }

        # Log workflow states and actions
        print(f"[WORKFLOW_LOG] State: {session.currentWorkflowState} | Action Received: {message} | Handler: process_message")

        # Explicitly support early intercept of actions before Gemini or routing
        if clean_msg in ["confirm details", "option:confirm details", "confirm", "yes", "correct"]:
            if session.currentWorkflowState == "PROFILE_CONFIRMATION":
                session.currentWorkflowState = "PROFILE_VERIFIED"
                return self.run_citizen_verification_flow(message, session, gemini_client)
        
        if clean_msg in ["modify details", "option:modify details", "modify"]:
            if session.currentWorkflowState == "PROFILE_CONFIRMATION" or session.currentWorkflowState == "PROFILE_COLLECTION":
                session.currentWorkflowState = "PROFILE_CONFIRMATION"
                session.step = "MODIFY_PROFILE_SELECT"
                return {
                    "intercepted": True,
                    "response": "Which profile detail would you like to modify?\n\n- [1. Full Name](option:1)\n- [2. Mobile Number](option:2)\n- [3. Location](option:3)\n- [4. Complete Address](option:4)",
                    "suggestions": ["1", "2", "3", "4"]
                }
            elif session.currentWorkflowState == "APPLICATION_REVIEW":
                session.currentWorkflowState = "APPLICATION_MODIFICATION"
                session.step = "MODIFY_SELECT"
                fields = self.get_workflow_fields(session)
                field_list = ""
                for idx, f in enumerate(fields, 1):
                    val = session.data.get(f["name"], "")
                    field_list += f"- [{idx}. {f['label']} ({val})](option:{idx})\n"
                return {
                    "intercepted": True,
                    "response": f"👮 Which field would you like to modify?\n\n{field_list}",
                    "suggestions": [str(i) for i in range(1, len(fields) + 1)]
                }


        if clean_msg in ["submit application", "option:submit application", "confirm submission", "yes, submit", "submit"]:
            if session.currentWorkflowState == "APPLICATION_REVIEW":
                return self._finalize_workflow(session)
            elif session.currentWorkflowState == "APPLICATION_SUBMITTED":
                return {
                    "intercepted": True,
                    "response": "This application has already been submitted.",
                    "suggestions": ["Track Application", "Download Receipt", "Start New Request"]
                }

        if clean_msg in ["track application", "option:track application", "track status", "track", "status"]:
            session.workflow = "tracking"
            session.step = "2"
            session.currentWorkflowState = "SERVICE_COLLECTION"
            return {
                "intercepted": True,
                "response": "Please provide your Application Reference Number for tracking (e.g. UP-CMP-2026-123456):",
                "suggestions": []
            }

        if clean_msg in ["start new request", "option:start new request"]:
            session.workflow = None
            session.step = 0
            session.currentWorkflowState = "START"
            session.data = {}
            return {
                "intercepted": True,
                "response": "Hello and welcome.\n\nHow can I assist you today?",
                "suggestions": ["File Complaint", "Tenant Verification", "Character Certificate", "Event Permission", "Track Application"]
            }

        # Feedback response intercept
        step_str = str(session.step)
        is_profile_step = session.currentWorkflowState in ["PROFILE_COLLECTION", "PROFILE_CONFIRMATION", "PROFILE_VERIFIED"] or step_str in [
            'IDENTIFY_NAME', 'CONFIRM_NAME', 'IDENTIFY_MOBILE', 'IDENTIFY_LOCATION', 
            'CONFIRM_CITY', 'CONFIRM_AUTO_LOCATION', 'IDENTIFY_ADDRESS', 'CONFIRM_PROFILE',
            'MODIFY_PROFILE_SELECT', 'MODIFY_PROFILE_INPUT'
        ]
        is_workflow_active_step = session.step == 'REVIEW' or (
            session.workflow and str(session.step) in ['1','2','3','4','5','6','2_brand','2_model','2_color','2_year','2_imei']
        )
        if not is_profile_step and not is_workflow_active_step:
            if step_str == "ASK_FEEDBACK":
                rating = None
                num_match = re.search(r"\b([1-5])\b", clean_msg)
                if num_match:
                    rating = int(num_match.group(1))
                else:
                    rating_map = {
                        "😊": 5, "😃": 4, "😐": 3, "🙁": 2, "😡": 1,
                        "very helpful": 5, "helpful": 4, "neutral": 3, "not helpful": 2, "very unhelpful": 1,
                        "बहुत सहायक": 5, "सहायक": 4, "सामान्य": 3, "सहायक नहीं": 2, "बहुत खराब": 1,
                        "yes": 5, "👍": 5, "no": 2, "👎": 2
                    }
                    for k, v in rating_map.items():
                        if k in clean_msg:
                            rating = v
                            break
                
                if rating is None:
                    feedback_ask_prompt = format_message("FEEDBACK_ASK", session.language, session)
                    if session.language == "hi":
                        rating_sugs = ["5 - बहुत मददगार", "4 - मददगार", "3 - सामान्य", "2 - सुधार की आवश्यकता", "1 - मददगार नहीं"]
                    else:
                        rating_sugs = ["5 - Very Helpful", "4 - Helpful", "3 - Neutral", "2 - Needs Improvement", "1 - Not Helpful"]
                    return {
                        "intercepted": True,
                        "response": f"{feedback_ask_prompt}\n(Please select a rating from 1 to 5)",
                        "suggestions": rating_sugs
                    }
                
                session.data["feedback_rating"] = rating
                
                if rating >= 4:
                    session.step = "START"
                    session.currentWorkflowState = "START"
                    session.workflow = None
                    session.data = {}
                    
                    feedback_thanks = "👮 Thank you for your feedback! It helps me learn and serve you better."
                    if session.language == "hi":
                        feedback_thanks = "👮 आपकी प्रतिक्रिया के लिए धन्यवाद! यह मुझे सीखने और आपको बेहतर सेवा देने में मदद करता है।"
                    elif session.language == "hinglish":
                        feedback_thanks = "👮 Feedback ke liye thank you! Ye mujhe improve karne aur aapko better serve karne mein help karta hai."
                        
                    db_action = {
                        "type": "citizen_feedback",
                        "data": {
                            "sessionId": session_id,
                            "citizenId": session.citizenId,
                            "workflowType": session.serviceType,
                            "rating": rating,
                            "comments": "",
                            "category": "OTHER"
                        }
                    }
                    return {
                        "intercepted": True,
                        "response": feedback_thanks,
                        "suggestions": ["File Complaint", "Tenant Verification", "Track Status"],
                        "db_action": db_action
                    }
                elif rating == 3:
                    session.step = "FEEDBACK_COMMENT_OPTIONAL"
                    feedback_comment_prompt = format_message("FEEDBACK_COMMENT_ASK", session.language, session)
                    skip_sug = "छोड़ें" if session.language == "hi" else "Skip"
                    return {
                        "intercepted": True,
                        "response": feedback_comment_prompt,
                        "suggestions": [skip_sug]
                    }
                else:
                    session.step = "FEEDBACK_COMMENT_REQUIRED"
                    feedback_comment_prompt = format_message("FEEDBACK_COMMENT_ASK", session.language, session)
                    return {
                        "intercepted": True,
                        "response": feedback_comment_prompt,
                        "suggestions": []
                    }
            
            if step_str == "FEEDBACK_COMMENT_OPTIONAL":
                rating = session.data.get("feedback_rating", 3)
                is_skip = clean_msg in ["skip", "छोड़ें", "option:skip", "option:छोड़ें"]
                comments = "" if is_skip else message.strip()
                category = classify_feedback(comments)
                
                session.step = "START"
                session.currentWorkflowState = "START"
                session.workflow = None
                session.data = {}
                
                feedback_thanks = "👮 Thank you for your feedback! It helps me learn and serve you better."
                if session.language == "hi":
                    feedback_thanks = "👮 आपकी प्रतिक्रिया के लिए धन्यवाद! यह मुझे सीखने और आपको बेहतर सेवा देने में मदद करता है।"
                elif session.language == "hinglish":
                    feedback_thanks = "👮 Feedback ke liye thank you! Ye mujhe improve karne aur aapko better serve karne mein help karta hai."
                    
                db_action = {
                    "type": "citizen_feedback",
                    "data": {
                        "sessionId": session_id,
                        "citizenId": session.citizenId,
                        "workflowType": session.serviceType,
                        "rating": rating,
                        "comments": comments,
                        "category": category
                    }
                }
                return {
                    "intercepted": True,
                    "response": feedback_thanks,
                    "suggestions": ["File Complaint", "Tenant Verification", "Track Status"],
                    "db_action": db_action
                }
                
            if step_str == "FEEDBACK_COMMENT_REQUIRED":
                rating = session.data.get("feedback_rating", 2)
                is_skip = clean_msg in ["skip", "छोड़ें", "option:skip", "option:छोड़ें"]
                comments = message.strip()
                if is_skip or not comments:
                    comment_required_msg = "👮 Comments are required for ratings of 2 or less. Please let us know how we can improve."
                    if session.language == "hi":
                        comment_required_msg = "👮 2 या उससे कम की रेटिंग के लिए टिप्पणी आवश्यक है। कृपया हमें बताएं कि हम कैसे सुधार कर सकते हैं।"
                    elif session.language == "hinglish":
                        comment_required_msg = "👮 2 ya usse kam rating ke liye comment dena zaroori hai. Please batayein hum kaise improve karein."
                    return {
                        "intercepted": True,
                        "response": comment_required_msg,
                        "suggestions": []
                    }
                    
                category = classify_feedback(comments)
                session.step = "START"
                session.currentWorkflowState = "START"
                session.workflow = None
                session.data = {}
                
                feedback_thanks = "👮 Thank you for your feedback! It helps me learn and serve you better."
                if session.language == "hi":
                    feedback_thanks = "👮 आपकी प्रतिक्रिया के लिए धन्यवाद! यह मुझे सीखने और आपको बेहतर सेवा देने में मदद करता है।"
                elif session.language == "hinglish":
                    feedback_thanks = "👮 Feedback ke liye thank you! Ye mujhe improve karne aur aapko better serve karne mein help karta hai."
                    
                db_action = {
                    "type": "citizen_feedback",
                    "data": {
                        "sessionId": session_id,
                        "citizenId": session.citizenId,
                        "workflowType": session.serviceType,
                        "rating": rating,
                        "comments": comments,
                        "category": category
                    }
                }
                return {
                    "intercepted": True,
                    "response": feedback_thanks,
                    "suggestions": ["File Complaint", "Tenant Verification", "Track Status"],
                    "db_action": db_action
                }

        # Check for cancel command
        if clean_msg in ["cancel", "radd", "रद्द", "exit", "stop", "option:cancel"]:
            session.workflow = None
            session.step = 0
            session.currentWorkflowState = "START"
            session.data = {}
            return {
                "intercepted": True,
                "response": "Current operation cancelled. How else can I help you?",
                "suggestions": ["File Complaint", "Tenant Verification", "Character Certificate", "Event Permission", "Track Application"]
            }

        # Handle tracking lookup bypassing the workflow state machine
        if session.workflow == "tracking":
            ref_num = message.strip()
            if ref_num.lower() in ["track status", "track application", "track", "status", "option:track status", "option:track application"]:
                session.step = "2"
                return {
                    "intercepted": True,
                    "response": "Please provide your Application Reference Number for tracking (e.g. UP-CMP-2026-123456):",
                    "suggestions": []
                }
            # Reset tracking session state immediately
            session.workflow = None
            session.step = "START"
            session.currentWorkflowState = "START"
            session.data = {}
            
            ref_upper = ref_num.upper()
            valid_format = any(ref_upper.startswith(prefix) for prefix in ["UP-CMP-", "UP-TV-", "UP-CC-", "UP-EP-", "UP-VER-", "UP-CER-", "UP-EVP-"])
            if not valid_format:
                return {
                    "intercepted": True,
                    "response": "👮 The reference number format appears invalid. Please enter a valid reference number (e.g. UP-CMP-2026-123456):",
                    "suggestions": ["File Complaint", "Tenant Verification", "Track Status"]
                }
            
            return {
                "intercepted": True,
                "response": "Querying tracking record...", # This will be overwritten by NestJS
                "suggestions": ["File Complaint", "Tenant Verification", "Track Status"],
                "db_action": {
                    "type": "track_query",
                    "data": {
                        "referenceNumber": ref_upper,
                        "language": session.language
                    }
                }
            }

        # Detect starting new workflow
        if not session.workflow:
            detected_wf = self.detect_workflow_intent(clean_msg)
            if detected_wf:
                session.workflow = detected_wf
                session.step = 0
                session.data = {}

        if not session.workflow:
            return {"intercepted": False}


        # Map session state variable on initial workflow starting
        if session.currentWorkflowState == "START":
            session.currentWorkflowState = "PROFILE_COLLECTION"

        # Prevent duplicate submissions
        if session.currentWorkflowState == "APPLICATION_SUBMITTED":
            return {
                "intercepted": True,
                "response": f"👮 Your request has already been submitted successfully under reference number **{session.referenceNumber}**.\n\nIs there anything else I can help you with today?",
                "suggestions": ["Track Application", "Download Receipt", "Start New Request"]
            }

        # Enforce Citizen Verification first (except for tracking)
        if session.currentWorkflowState in ["PROFILE_COLLECTION", "PROFILE_CONFIRMATION", "PROFILE_VERIFIED"] and session.workflow != "tracking":
            if not session.profileConfirmed and not session.isConfirmed:
                if session.currentWorkflowState == "PROFILE_COLLECTION" and getattr(session, "step", "") == "CONFIRM_PROFILE":
                    session.currentWorkflowState = "PROFILE_CONFIRMATION"
                res = self.run_citizen_verification_flow(message, session, gemini_client)
                if session.profileConfirmed or session.isConfirmed:
                    session.currentWorkflowState = "PROFILE_VERIFIED"
                return res

        # Align current state
        if session.currentWorkflowState == "PROFILE_VERIFIED":
            session.currentWorkflowState = "SERVICE_COLLECTION"

        # Pre-Submission Review screen step mapping
        if session.currentWorkflowState == "APPLICATION_REVIEW":
            if clean_msg in ["yes", "submit", "confirm", "submit application", "confirm details", "confirm submission", "yes, submit", "option:yes", "option:submit application", "option:confirm details", "option:confirm submission"]:
                name_valid = validate_name(session.fullName)
                mobile_valid = validate_mobile(session.mobileNumber)
                location_valid = bool(session.city or session.district)
                fields = self.get_workflow_fields(session)
                fields_complete = all(session.data.get(f["name"]) for f in fields)
                if name_valid and mobile_valid and location_valid and fields_complete:
                    return self._finalize_workflow(session)
                else:
                    return {
                        "intercepted": True,
                        "response": "⚠️ **Cannot Submit:** Some validations are still missing. Could you please provide the information in a different way or modify details?",
                        "suggestions": ["Modify Details"]
                    }
            elif clean_msg in ["no", "modify", "modify details", "option:no", "option:modify details"]:
                session.currentWorkflowState = "APPLICATION_MODIFICATION"
                session.step = "MODIFY_SELECT"
                fields = self.get_workflow_fields(session)
                field_list = ""
                for idx, f in enumerate(fields, 1):
                    val = session.data.get(f["name"], "")
                    field_list += f"- [{idx}. {f['label']} ({val})](option:{idx})\n"
                
                return {
                    "intercepted": True,
                    "response": f"👮 Which field would you like to modify?\n\n{field_list}",
                    "suggestions": [str(i) for i in range(1, len(fields) + 1)]
                }
            else:
                # Check for natural language corrections on review screen
                is_corr = self.handle_profile_correction(session, message)
                if is_corr:
                    return self.render_presubmission_review_screen(session)
                
                return {
                    "intercepted": True,
                    "response": "I'm sorry, please select either 'Submit Application' to proceed or 'Modify Details' to make changes.",
                    "suggestions": ["Submit Application", "Modify Details"]
                }

        # Handle modify flows
        if session.currentWorkflowState == "APPLICATION_MODIFICATION":
            if str(session.step) == "MODIFY_SELECT":
                fields = self.get_workflow_fields(session)
                selected_field = None
                for idx, f in enumerate(fields, 1):
                    if clean_msg == str(idx) or f["name"] in clean_msg or f["label"].lower() in clean_msg:
                        selected_field = f
                        break
                
                if selected_field:
                    session.step = "MODIFY_INPUT"
                    session.currentExpectedField = selected_field["name"]
                    return {
                        "intercepted": True,
                        "response": f"Please enter the new value for **{selected_field['label']}**:",
                        "suggestions": selected_field.get("suggestions", [])
                    }
                else:
                    field_list = ""
                    for idx, f in enumerate(fields, 1):
                        val = session.data.get(f["name"], "")
                        field_list += f"- [{idx}. {f['label']} ({val})](option:{idx})\n"
                    return {
                        "intercepted": True,
                        "response": f"I may not have understood correctly. Could you please select a valid field to modify?\n\n{field_list}",
                        "suggestions": [str(i) for i in range(1, len(fields) + 1)]
                    }

            if str(session.step) == "MODIFY_INPUT":
                field_name = getattr(session, "currentExpectedField", "")
                if not field_name:
                    session.currentWorkflowState = "APPLICATION_REVIEW"
                    session.step = "REVIEW"
                    return self.render_presubmission_review_screen(session)
                    
                is_valid = self.validate_workflow_field(session.workflow, field_name, message, session)
                if not is_valid:
                    error_msg = self.get_workflow_field_error_msg(session.workflow, field_name, session.language)
                    return {
                        "intercepted": True,
                        "response": error_msg,
                        "suggestions": []
                    }
                
                session.data[field_name] = message
                db_action_list = []
                log_audit(session, "field_modified", {"field": field_name, "value": message}, db_action_list)
                session.currentExpectedField = ""
                session.currentWorkflowState = "APPLICATION_REVIEW"
                session.step = "REVIEW"
                return self.render_presubmission_review_screen(session)

        # Main active workflow logic
        session.currentWorkflowState = "SERVICE_COLLECTION"
        fields = self.get_workflow_fields(session)

        # PRP flow interceptor
        if self.requires_profile_reuse(session.workflow) and (str(session.step) in ['1', 'PRP_INIT', 'PRP_CHOICE', 'PRP_CONFIRM', 'ORG_NAME', 'ORG_ADDRESS', 'ORG_MOBILE']):
            prp_res = self.handle_profile_reuse_protocol_flow(session, message)
            if prp_res is not None:
                return prp_res

        # Auto-detect fields on start
        if session.step == 0:
            if session.workflow == "complaint":
                auto_type = None
                if any(w in clean_msg for w in ["phone", "mobile", "stolen", "theft", "chori", "फ़ोन", "मोबाइल", "फोन", "चोरी", "चोर", "chora"]):
                    auto_type = "LOST_MOBILE"
                elif any(w in clean_msg for w in ["document", "wallet", "passport", "aadhar", "card"]):
                    auto_type = "LOST_DOCUMENT"
                
                if auto_type:
                    session.data["complaint_type"] = auto_type
                    session.step = 1
 
        # Enforce step validations before moving forward
        if isinstance(session.step, int) and session.step > 0:
            prev_field_name = fields[session.step - 1]["name"]
            session.currentExpectedField = prev_field_name
            
            # Run field validation on message input
            is_valid = self.validate_workflow_field(session.workflow, prev_field_name, message, session)
            if not is_valid:
                # Validation failed! Return error and keep step unchanged (no restart)
                error_msg = self.get_workflow_field_error_msg(session.workflow, prev_field_name, session.language)
                return {
                    "intercepted": True,
                    "response": error_msg,
                    "suggestions": fields[session.step - 1].get("suggestions", [])
                }
            
            # Save valid data (mapping complaint type to canonical keys)
            val_to_save = message
            if session.workflow == "complaint" and prev_field_name == "complaint_type":
                val_clean = message.lower()
                if any(w in val_clean for w in ["mobile", "phone", "stolen", "theft", "chori", "गुम", "चोरी", "chora"]):
                    val_to_save = "LOST_MOBILE"
                elif any(w in val_clean for w in ["document", "wallet", "passport", "aadhar", "card"]):
                    val_to_save = "LOST_DOCUMENT"
                elif any(w in val_clean for w in ["harass", "harassment", "teasing", "threat", "trolling", "pareshan", "dhamki", "उत्पीड़न", "परेशान", "धमकी"]):
                    val_to_save = "SIMPLE_HARASSMENT"
                elif any(w in val_clean for w in ["fraud", "scam", "cheated", "dhokha", "cyber", "धोखा", "धोखाधड़ी", "साइबर"]):
                    val_to_save = "CYBER_FRAUD"

            session.data[prev_field_name] = val_to_save
            if prev_field_name == "name" and len(message.strip().split()) == 1:
                session.data["name_suggest_flag"] = True
 
        # Recalculate fields list dynamically in case a field change (like complaint type) alters the fields list
        fields = self.get_workflow_fields(session)

        # Prompt next field or transition to Review Screen
        if session.step < len(fields):
            next_field = fields[session.step]
            session.step += 1
            session.currentExpectedField = next_field["name"]
            response_txt = self._format_question(session, next_field, session.language, session.step)
            if session.data.get("name_suggest_flag"):
                response_txt = "*(Polite Suggestion: Providing a full name with surname is recommended for official records, but we can proceed.)*\n\n" + response_txt
                session.data["name_suggest_flag"] = False
            return {
                "intercepted": True,
                "response": response_txt,
                "suggestions": next_field["suggestions"]
            }
        else:
            # We collected all fields. Enforce Rejection Prevention Layer consistency and completeness checks!
            session.currentWorkflowState = "APPLICATION_REVIEW"
            session.step = "REVIEW"
            session.currentExpectedField = ""
            return self.render_presubmission_review_screen(session)

    def detect_workflow_intent(self, clean_msg: str) -> str | None:
        if any(w in clean_msg for w in ["complaint", "stolen", "report", "shikayat", "शिकायत", "lost", "wallet", "chori", "chora", "kho gaya", "kho", "gum", "pocket", "fraud", "scam"]):
            return "complaint"
        if any(w in clean_msg for w in ["tenant", "verification", "satyapan", "rent", "किरायेदार", "सत्यापन"]):
            return "verification"
        if any(w in clean_msg for w in ["character", "certificate", "charitra", "चरित्र", "प्रमाण"]):
            return "certificate"
        if any(w in clean_msg for w in ["event", "permission", "protest", "procession", "shooting", "आयोजन", "अनुमति"]):
            return "event"
        if any(w in clean_msg for w in ["track", "status", "check status", "pata karein", "स्थिति"]):
            return "tracking"
        return None

    def validate_workflow_field(self, workflow: str, field_name: str, value: str, session: WorkflowSession) -> bool:
        if workflow == "complaint":
            if field_name == "incident_time":
                return validate_date(value, reject_future=True)
            if field_name == "incident_description":
                # Check consistency between citizen city and report details
                return validate_consistency(session.city, value)
            if field_name == "mobile_brand":
                return len(value.strip()) > 0
            if field_name == "mobile_model":
                return len(value.strip()) > 0
            if field_name == "mobile_color":
                return len(value.strip()) > 0
            if field_name == "purchase_year":
                val_clean = value.strip()
                return val_clean.isdigit() and len(val_clean) == 4
            if field_name == "imei_number":
                val_clean = value.strip().lower()
                skip_vars = ["skip", "skip / छोड़ें", "chodein", "option:skip / छोड़ें", "option:skip", "none", "not available", "i don't know", "no", "na", "nahi", "n/a", "not provided", "no imei", "dont know", "don't know"]
                if val_clean in skip_vars:
                    return True
                return len(val_clean) == 15 and val_clean.isdigit()
        elif workflow == "verification":
            if field_name == "name":
                return validate_name(value)
            if field_name == "mobile":
                return validate_mobile(value)
        elif workflow == "certificate":
            if field_name == "name":
                return validate_name(value)
            if field_name == "purpose":
                # Ensure it is a valid purpose
                return value.strip() in ["Job Application", "Passport", "Visa", "Higher Education", "Government Service"]
        elif workflow == "event":
            if field_name == "date":
                return validate_date(value, reject_future=False)
            if field_name == "expected_attendance":
                return value.strip().isdigit()
        return True

    def get_workflow_field_error_msg(self, workflow: str, field_name: str, lang: str) -> str:
        errors = {
            "complaint": {
                "incident_time": "👮 As your citizen assistance officer, I'm here to help. The date appears invalid or in the future.\n\nPlease provide a valid date in DD/MM/YYYY format:\nExample: 15/07/2026",
                "incident_description": "👮 As your citizen assistance officer, I noticed a location contradiction in your details relative to your registered location. Please verify and confirm details again.",
                "mobile_brand": "👮 Please provide a valid mobile brand name.",
                "mobile_model": "👮 Please provide a valid mobile model name.",
                "mobile_color": "👮 Please provide the color of the mobile phone.",
                "purchase_year": "👮 Please enter a valid 4-digit purchase year (e.g. 2024).",
                "imei_number": "👮 IMEI must be a 15-digit number, or you can skip it by entering 'skip'.\nExample: 359872081726354 or skip"
            },
            "verification": {
                "name": "👮 As your citizen assistance officer, I want to help you complete this. Please enter a valid name (at least 2 letters):\nExample: Rahul Kumar or Raju",
                "mobile": "👮 As your citizen assistance officer, I want to help you complete this. The mobile number appears incomplete.\n\nPlease provide a valid 10-digit Indian mobile number.\n\nExample:\n9876543210"
            },
            "certificate": {
                "name": "👮 As your citizen assistance officer, I want to help you complete this. Please enter a valid name (at least 2 letters):\nExample: Rahul Kumar or Raju",
                "purpose": "👮 As your citizen assistance officer, I want to help you complete this. Could you please select a valid purpose?\n\nExamples:\n• Job Application\n• Passport\n• Visa\n• Higher Education\n• Government Service"
            },
            "event": {
                "date": "👮 As your citizen assistance officer, I want to help you complete this. Please provide a valid date in DD/MM/YYYY format:\nExample: 15/08/2026",
                "expected_attendance": "👮 As your citizen assistance officer, I want to help you complete this. Please enter a valid number for expected attendance:\nExample: 500"
            }
        }
        return errors.get(workflow, {}).get(field_name, "⚠️ I may not have understood correctly. Could you please provide that information in a different way?")
    def requires_profile_reuse(self, workflow: str) -> bool:
        return workflow in ['certificate', 'event']

    def handle_profile_reuse_protocol_flow(self, session: WorkflowSession, message: str) -> dict | None:
        lang = session.language
        clean_msg = message.strip().lower()
        step = str(session.step)

        address_parts = [
            session.addressLine1,
            session.addressLine2,
            session.city,
            session.pincode
        ]
        address_str = ", ".join([p for p in address_parts if p])

        prompts = {
            "en": {
                "foundProfile": f"I found a verified profile:\n\nName: **{session.fullName}**\nAddress: **{address_str}**\n\nHow would you like to proceed?",
                "options": ["Use My Verified Details", "Apply For Someone Else"],
                "confirmUse": f"I will use your verified details for this application.\n\nName: **{session.fullName}**\nAddress: **{address_str}**\n\nContinue?",
                "confirmOptions": ["Continue", "Modify Details"],
            },
            "hi": {
                "foundProfile": f"मुझे एक सत्यापित प्रोफ़ाइल मिली है:\n\nनाम: **{session.fullName}**\nपता: **{address_str}**\n\nआप कैसे आगे बढ़ना चाहेंगे?",
                "options": ["मेरे सत्यापित विवरण का उपयोग करें", "किसी अन्य व्यक्ति के लिए आवेदन करें"],
                "confirmUse": f"मैं इस आवेदन के लिए आपके सत्यापित विवरणों का उपयोग करूँगा।\n\nनाम: **{session.fullName}**\nपता: **{address_str}**\n\nजारी रखें?",
                "confirmOptions": ["जारी रखें", "विवरण बदलें"],
            },
            "hinglish": {
                "foundProfile": f"Mujhe ek verified profile mili hai:\n\nName: **{session.fullName}**\nAddress: **{address_str}**\n\nKaise proceed karna chahenge?",
                "options": ["Use My Verified Details", "Apply For Someone Else"],
                "confirmUse": f"Main is application ke liye aapke verified details use karunga.\n\nName: **{session.fullName}**\nAddress: **{address_str}**\n\nContinue?",
                "confirmOptions": ["Continue", "Modify Details"],
            }
        }

        if step in ['1', 'PRP_INIT']:
            session.step = 'PRP_CHOICE'
            return {
                "intercepted": True,
                "response": prompts[lang]["foundProfile"],
                "suggestions": prompts[lang]["options"]
            }

        if step == 'PRP_CHOICE':
            is_self = "use my verified details" in clean_msg or "मेरे सत्यापित विवरण" in clean_msg or clean_msg == "myself" or clean_msg == "mere liye" or "option:use my verified details" in clean_msg or "option:mere सत्यापित विवरण" in clean_msg
            is_someone_else = "someone else" in clean_msg or "किसी अन्य व्यक्ति" in clean_msg or "kisi aur" in clean_msg or clean_msg == "someone else" or clean_msg == "kisi aur ke liye" or "option:apply for someone else" in clean_msg or "option:किसी अन्य व्यक्ति" in clean_msg

            if is_self:
                session.data["prpSource"] = "REUSED"
                if session.workflow == "certificate":
                    session.data["name"] = session.fullName
                    session.data["address"] = address_str
                    session.data["district"] = session.district or session.city or 'Lucknow'
                    session.data["isSelf"] = True
                elif session.workflow == "event":
                    session.data["organizerName"] = session.fullName
                    session.data["organizerAddress"] = address_str
                    session.data["organizerMobile"] = session.mobileNumber
                    session.data["organizerIsApplicant"] = True
                    session.data["isSelf"] = True
                session.step = 'PRP_CONFIRM'
                return {
                    "intercepted": True,
                    "response": prompts[lang]["confirmUse"],
                    "suggestions": prompts[lang]["confirmOptions"]
                }
            elif is_someone_else:
                session.data["prpSource"] = "MANUAL"
                if session.workflow == "certificate":
                    session.data["isSelf"] = False
                    session.step = 2
                    first_field = self.workflow_fields["certificate"][0]
                    session.currentExpectedField = first_field["name"]
                    return {
                        "intercepted": True,
                        "response": self._format_question(session, first_field, lang, 2),
                        "suggestions": first_field.get("suggestions", [])
                    }
                elif session.workflow == "event":
                    session.data["organizerIsApplicant"] = False
                    session.step = "ORG_NAME"
                    session.currentExpectedField = "organizerName"
                    return {
                        "intercepted": True,
                        "response": "Please enter the Organizer's Full Name:",
                        "suggestions": []
                    }
            else:
                return {
                    "intercepted": True,
                    "response": prompts[lang]["foundProfile"],
                    "suggestions": prompts[lang]["options"]
                }

        if step == 'PRP_CONFIRM':
            is_continue = clean_msg == 'continue' or "option:continue" in clean_msg or "जारी रखें" in clean_msg or "option:जारी रखें" in clean_msg
            is_modify = clean_msg == 'modify details' or "option:modify details" in clean_msg or "विवरण बदलें" in clean_msg or "option:विवरण बदलें" in clean_msg

            if is_continue:
                if session.workflow == "certificate":
                    session.step = 4
                    purpose_field = self.workflow_fields["certificate"][3]
                    session.currentExpectedField = purpose_field["name"]
                    return {
                        "intercepted": True,
                        "response": self._format_question(session, purpose_field, lang, 4),
                        "suggestions": purpose_field.get("suggestions", [])
                    }
                elif session.workflow == "event":
                    session.step = 2
                    name_field = self.workflow_fields["event"][1]
                    session.currentExpectedField = name_field["name"]
                    return {
                        "intercepted": True,
                        "response": self._format_question(session, name_field, lang, 2),
                        "suggestions": name_field.get("suggestions", [])
                    }
            elif is_modify:
                session.data["prpSource"] = "MANUAL"
                if session.workflow == "certificate":
                    session.data["isSelf"] = False
                    session.step = 2
                    first_field = self.workflow_fields["certificate"][0]
                    session.currentExpectedField = first_field["name"]
                    return {
                        "intercepted": True,
                        "response": self._format_question(session, first_field, lang, 2),
                        "suggestions": first_field.get("suggestions", [])
                    }
                elif session.workflow == "event":
                    session.data["organizerIsApplicant"] = False
                    session.step = "ORG_NAME"
                    session.currentExpectedField = "organizerName"
                    return {
                        "intercepted": True,
                        "response": "Please enter the Organizer's Full Name:",
                        "suggestions": []
                    }
            else:
                return {
                    "intercepted": True,
                    "response": prompts[lang]["confirmUse"],
                    "suggestions": prompts[lang]["confirmOptions"]
                }

        if step == 'ORG_NAME':
            if not validate_name(message):
                return {
                    "intercepted": True,
                    "response": "⚠️ Please enter a valid organizer full name (first name and last name):",
                    "suggestions": []
                }
            session.data["organizerName"] = message.strip().title()
            session.step = 'ORG_ADDRESS'
            return {
                "intercepted": True,
                "response": "Please enter the Organizer's Complete Address:",
                "suggestions": []
            }

        if step == 'ORG_ADDRESS':
            session.data["organizerAddress"] = message.strip()
            session.step = 'ORG_MOBILE'
            return {
                "intercepted": True,
                "response": "Please enter the Organizer's Mobile Number:",
                "suggestions": []
            }

        if step == 'ORG_MOBILE':
            if not validate_mobile(message):
                return {
                    "intercepted": True,
                    "response": "⚠️ Please provide a valid 10-digit mobile number:",
                    "suggestions": []
                }
            session.data["organizerMobile"] = normalize_mobile(message)
            session.step = 2
            name_field = self.workflow_fields["event"][1]
            session.currentExpectedField = name_field["name"]
            return {
                "intercepted": True,
                "response": self._format_question(session, name_field, lang, 2),
                "suggestions": name_field.get("suggestions", [])
            }
        return None

    def render_presubmission_review_screen(self, session: WorkflowSession) -> dict:
        name_valid = validate_name(session.fullName)
        mobile_valid = validate_mobile(session.mobileNumber)
        location_valid = bool(session.city or session.district)
        address_valid = bool(session.addressLine1)
        
        fields = self.get_workflow_fields(session)
        fields_complete = all(session.data.get(f["name"]) for f in fields)
        
        # Calculate checkbox readiness
        applicant_ok = bool(session.fullName and session.mobileNumber)
        subject_ok = fields_complete
        contact_ok = validate_mobile(session.mobileNumber)
        address_ok = bool(session.addressLine1)
        location_ok = bool(session.city or session.district)
        required_ok = fields_complete
        ready_ok = applicant_ok and subject_ok and contact_ok and address_ok and location_ok and required_ok
        
        # Format localized validation checklist
        check_applicant = format_message("CHECK_APPLICANT_COMPLETE", session.language, session)
        check_subject = format_message("CHECK_SUBJECT_COMPLETE", session.language, session)
        check_contact = format_message("CHECK_CONTACT_VALID", session.language, session)
        check_address = format_message("CHECK_ADDRESS_COMPLETE", session.language, session)
        check_location = format_message("CHECK_LOCATION_CONFIRMED", session.language, session)
        check_required = format_message("CHECK_REQUIRED_FIELDS", session.language, session)
        check_ready = format_message("CHECK_READY_FOR_SUBMISSION", session.language, session)
        
        checklist = (
            f"{'✓' if applicant_ok else '✗'} {check_applicant}\n"
            f"{'✓' if subject_ok else '✗'} {check_subject}\n"
            f"{'✓' if contact_ok else '✗'} {check_contact}\n"
            f"{'✓' if address_ok else '✗'} {check_address}\n"
            f"{'✓' if location_ok else '✗'} {check_location}\n"
            f"{'✓' if required_ok else '✗'} {check_required}\n"
            f"{'✓' if ready_ok else '✗'} {check_ready}"
        )
        
        address_display = f"{session.addressLine1}"
        if session.addressLine2:
            address_display += f", {session.addressLine2}"
        if session.pincode:
            address_display += f" - {session.pincode}"
            
        # Localized review screen labels
        title_text = format_message("REVIEW_TITLE", session.language, session)
        applicant_profile_text = format_message("REVIEW_APPLICANT_PROFILE", session.language, session)
        service_type_text = format_message("REVIEW_SERVICE_TYPE", session.language, session)
        validation_status_text = format_message("REVIEW_VALIDATION_STATUS", session.language, session)
        
        address_fallback = "प्रदान नहीं किया गया" if session.language == "hi" else "Not provided"
        district_val = localize_location(session.city or session.district or 'Lucknow', session.language)
        
        applicant_details = (
            f"👤 **{applicant_profile_text}**\n"
            f"- Name: **{session.fullName}**\n"
            f"- Mobile: **{session.mobileNumber}**\n"
            f"- Location: **{district_val}**\n"
            f"- Address: **{address_display or address_fallback}**\n"
        )
        
        subject_details = ""
        service_details = f"📋 **{service_type_text}** {session.workflow.capitalize()}\n"
        
        if session.workflow == "complaint":
            incident_details_header = format_message("REVIEW_INCIDENT_DETAILS", session.language, session)
            device_info_header = format_message("REVIEW_DEVICE_INFORMATION", session.language, session)
            
            complaint_type_display = session.data.get("complaint_type")
            translated_comp_type = format_message(complaint_type_display, session.language, session)
            if translated_comp_type == complaint_type_display:
                translated_comp_type = complaint_type_display

            subject_details = (
                f"📝 **{incident_details_header}**\n"
                f"- Complaint Type: **{translated_comp_type}**\n"
                f"- Incident Location: **{session.data.get('incident_location')}**\n"
                f"- Incident Date: **{session.data.get('incident_time')}**\n"
                f"- Description: **{session.data.get('incident_description')}**"
            )
            if session.data.get("complaint_type") in ["Lost Mobile / Theft", "LOST_MOBILE"]:
                imei_val = session.data.get("imei_number")
                skip_vars = ["skip", "skip / छोड़ें", "chodein", "none", "not available", "i don't know", "no", "na", "nahi", "n/a", "not provided", "no imei", "dont know", "don't know"]
                if not imei_val or imei_val.strip().lower() in skip_vars:
                    imei_val = "प्रदान नहीं किया गया" if session.language == "hi" else "Not Provided"
                subject_details += (
                    f"\n\n📱 **{device_info_header}**\n"
                    f"- Brand: **{session.data.get('mobile_brand')}**\n"
                    f"- Model: **{session.data.get('mobile_model')}**\n"
                    f"- Color: **{session.data.get('mobile_color')}**\n"
                    f"- Purchase Year: **{session.data.get('purchase_year')}**\n"
                    f"- IMEI: **{imei_val}**"
                )
        elif session.workflow == "verification":
            subject_details = (
                f"🔍 **Candidate Details (Subject):**\n"
                f"- Verification Type: **{session.data.get('verification_type')}**\n"
                f"- Candidate Full Name: **{session.data.get('name')}**\n"
                f"- Candidate Mobile Number: **{session.data.get('mobile')}**\n"
                f"- Candidate Permanent Address: **{session.data.get('address')}**\n"
                f"- Residing Property Details: **{session.data.get('property_details')}**"
            )
        elif session.workflow == "certificate":
            is_self = session.data.get("isSelf") == True
            source_label = "✓ Reused From Verified Profile" if is_self else "✓ Provided Manually"
            subject_details = (
                f"📜 **Certificate Request Details:**\n"
                f"- Subject Name: **{session.data.get('name')}**\n"
                f"- Subject Address: **{session.data.get('address')}**\n"
                f"- Applying District: **{session.data.get('district')}**\n"
                f"- Certificate Purpose: **{session.data.get('purpose')}**\n\n"
                f"**Subject Information Source:**\n"
                f"{source_label}"
            )
        elif session.workflow == "event":
            is_self = session.data.get("organizerIsApplicant") != False
            source_label = "✓ Reused From Verified Profile" if is_self else "✓ Provided Manually"
            subject_details = (
                f"🎭 **Event Permission Request Details:**\n"
                f"- Request Type: **{session.data.get('event_type')}**\n"
                f"- Event Name: **{session.data.get('event_name')}**\n"
                f"- Event Location/Route: **{session.data.get('location')}**\n"
                f"- Scheduled Date: **{session.data.get('date')}**\n"
                f"- Expected Attendance: **{session.data.get('expected_attendance')}**\n\n"
                f"**Organizer Information Source:**\n"
                f"{source_label}"
            )
            
        review_screen = (
            f"👮 **{title_text}**\n\n"
            f"{applicant_details}\n"
            f"{service_details}\n"
            f"{subject_details}\n\n"
            f"**{validation_status_text}**\n"
            f"```\n"
            f"{checklist}\n"
            f"```\n"
        )
        
        if ready_ok:
            if session.language == "hi":
                submit_label = "आवेदन सबमिट करें"
                modify_label = "विवरण बदलें"
                submit_text = "क्या आप इस आवेदन को सबमिट करना चाहते हैं?"
            else:
                submit_label = "Submit Application"
                modify_label = "Modify Details"
                submit_text = "Would you like to submit this application?"
                
            review_screen += (
                f"{submit_text}\n\n"
                f"- [{submit_label}](option:Submit Application)\n"
                f"- [{modify_label}](option:Modify Details)"
            )
            sugs = [submit_label, modify_label]
        else:
            if session.language == "hi":
                modify_label = "विवरण बदलें"
                cannot_submit_text = "⚠️ **सबमिट नहीं कर सकते:** कृपया सभी आवश्यक फ़ील्ड भरें और सुनिश्चित करें कि सत्यापन सफल हो।"
            else:
                modify_label = "Modify Details"
                cannot_submit_text = "⚠️ **Cannot Submit:** Please complete all required fields and ensure validations pass."
                
            review_screen += (
                f"{cannot_submit_text}\n\n"
                f"- [{modify_label}](option:Modify Details)"
            )
            sugs = [modify_label]
            
        return {
            "intercepted": True,
            "response": review_screen,
            "suggestions": sugs
        }

    def run_citizen_verification_flow(self, message: str, session: WorkflowSession, gemini_client=None) -> dict:
        clean_msg = message.strip().lower()

        # Extract location if possible from free text
        loc_extracted = extract_location(message)
        if loc_extracted:
            session.city = loc_extracted
            session.district = loc_extracted

        if gemini_client:
            extracted = gemini_client.extract_citizen_data(message)
            if extracted.get("fullName") and not session.fullName:
                session.fullName = extracted["fullName"]
            if extracted.get("mobileNumber") and not session.mobileNumber:
                session.mobileNumber = extracted["mobileNumber"]
            if extracted.get("email") and not session.email:
                session.email = extracted["email"]
            if extracted.get("location") and not session.city:
                session.city = extracted["location"]
                session.district = extracted["location"]

        phone_matches = re.findall(r"(?:\+91[\s-]?)?[6-9]\d{9}|\b[6-9]\d{9}\b", message)
        if phone_matches and not session.mobileNumber:
            norm = normalize_mobile(phone_matches[0])
            if norm and validate_mobile(norm):
                session.mobileNumber = norm

        # Check corrections (only if not in modify mode to prevent interference)
        step_str = str(session.step)
        if not step_str.startswith("MODIFY_"):
            is_corr = self.handle_profile_correction(session, message)
            if is_corr:
                session.step = "IDENTIFY_ADDRESS"
                district_val = localize_location(session.city, session.language)
                prompt_text = format_message("PROFILE_ADDRESS_REQUEST", session.language, session, {"district": district_val})
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }

        # State Machine steps
        if step_str == "IDENTIFY_MOBILE_FIRST":
            if validate_mobile(message):
                session.mobileNumber = normalize_mobile(message)
                session.step = "IDENTIFY_NAME"
                localized_not_found = format_message("PROFILE_NOT_FOUND", session.language, session)
                name_prompt = format_message("PROFILE_NAME_REQUEST", session.language, session)
                return {
                    "intercepted": True,
                    "response": f"{localized_not_found}\n\n{name_prompt}",
                    "suggestions": []
                }
            else:
                prompt_text = format_message("ERROR_VALIDATION_MOBILE", session.language, session)
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }
        elif step_str == "IDENTIFY_NAME":
            valid, confidence = validate_name_confidence(message)
            if valid:
                session.fullName = message.strip().title()
                if len(session.fullName.split()) == 1:
                    session.data["name_suggest_flag"] = True
                
                if session.mobileNumber:
                    session.step = "IDENTIFY_LOCATION"
                    prompt_text = format_message("PROFILE_LOCATION_REQUEST", session.language, session)
                    return {
                        "intercepted": True,
                        "response": prompt_text,
                        "suggestions": []
                    }
                else:
                    session.step = "IDENTIFY_MOBILE"
                    full_name_disp = format_name_with_honorific(session.fullName, session.language)
                    prompt_text = format_message("PROFILE_MOBILE_REQUEST", session.language, session, {"name": full_name_disp})
                    
                    if session.data.get("name_suggest_flag"):
                        suggest_text = "*(Polite Suggestion: Providing a full name with surname is recommended for official records, but we can proceed.)*\n\n"
                        if session.language == "hi":
                            suggest_text = "*(सुझाव: आधिकारिक अभिलेखों के लिए पूरा नाम देना उपयोगी होता है, लेकिन हम आगे बढ़ सकते हैं।)*\n\n"
                        elif session.language == "hinglish":
                            suggest_text = "*(Suggestion: Official records ke liye surname ke saath full name dena sahi rehta hai, par hum aage badh sakte hain.)*\n\n"
                        prompt_text = suggest_text + prompt_text
                        session.data["name_suggest_flag"] = False
                    return {
                        "intercepted": True,
                        "response": prompt_text,
                        "suggestions": []
                    }
            else:
                prompt_text = format_message("ERROR_VALIDATION_NAME", session.language, session)
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }
        elif step_str == "CONFIRM_NAME":
            if clean_msg in ["confirm", "yes", "correct", "confirm name", "option:confirm", "option:yes", "option:confirm name"]:
                session.fullName = session.data.get("pending_name", "").strip().title()
                if len(session.fullName.split()) == 1:
                    session.data["name_suggest_flag"] = True
                session.data.pop("pending_name", None)
            elif clean_msg in ["change", "no", "change name", "option:no", "option:change name"]:
                session.step = "IDENTIFY_NAME"
                session.data.pop("pending_name", None)
                msg = "Understood. Please enter your name again:"
                if session.language == "hi":
                    msg = "ठीक है। कृपया अपना नाम फिर से दर्ज करें:"
                elif session.language == "hinglish":
                    msg = "Understood. Please apna name phir se enter karein:"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": []
                }
            else:
                pending_name_disp = format_name_with_honorific(session.data.get('pending_name', ''), session.language)
                if session.language == "hi":
                    confirm_sug = "नाम की पुष्टि करें"
                    change_sug = "नाम बदलें"
                    msg = f"क्या '{pending_name_disp}' आपका सही पूरा नाम है?\n\n- [{confirm_sug}](option:Confirm Name)\n- [{change_sug}](option:Change Name)"
                else:
                    confirm_sug = "Confirm Name"
                    change_sug = "Change Name"
                    msg = f"Is '{pending_name_disp}' your correct full name?\n\n- [{confirm_sug}](option:Confirm Name)\n- [{change_sug}](option:Change Name)"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": [confirm_sug, change_sug]
                }
        elif step_str == "IDENTIFY_MOBILE":
            if validate_mobile(message):
                session.mobileNumber = normalize_mobile(message)
                session.step = "IDENTIFY_LOCATION"
                prompt_text = format_message("PROFILE_LOCATION_REQUEST", session.language, session)
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }
            else:
                prompt_text = format_message("ERROR_VALIDATION_MOBILE", session.language, session)
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }
        elif step_str == "IDENTIFY_LOCATION":
            trimmed_msg = message.strip()
            if "civil lines" in trimmed_msg.lower() or "near" in trimmed_msg.lower():
                session.step = "CONFIRM_CITY"
                session.data["incomplete_location"] = trimmed_msg
                msg = "Which city?"
                if session.language == "hi":
                    msg = "कौन सा शहर?"
                elif session.language == "hinglish":
                    msg = "Kaun sa city?"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": []
                }
            if len(message.strip()) >= 3:
                session.city = message.strip()
                session.district = message.strip()
                session.step = "CONFIRM_LOCATION"
                
                district_val = localize_location(session.city, session.language)
                msg = format_message("PROFILE_LOCATION_CONFIRM", session.language, session, {"district": district_val})
                confirm_sug = "पुष्टि करें" if session.language == "hi" else "Confirm"
                change_sug = "स्थान बदलें" if session.language == "hi" else "Change Location"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": [confirm_sug, change_sug]
                }
            else:
                msg = "I may not have understood correctly. Could you please provide that information in a different way?"
                if session.language == "hi":
                    msg = "मुझे समझ नहीं आया। कृपया दूसरी तरह से जानकारी प्रदान करें।"
                elif session.language == "hinglish":
                    msg = "Mujhe samajh nahi aaya. Please clear batayein."
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": []
                }
        elif step_str == "CONFIRM_CITY":
            city_input = message.strip()
            if len(city_input) >= 3:
                session.city = city_input
                session.district = city_input
                session.addressLine1 = session.data.get("incomplete_location", "")
                session.data.pop("incomplete_location", None)
                session.step = "CONFIRM_LOCATION"
                
                district_val = localize_location(session.city, session.language)
                msg = format_message("PROFILE_LOCATION_CONFIRM", session.language, session, {"district": district_val})
                confirm_sug = "पुष्टि करें" if session.language == "hi" else "Confirm"
                change_sug = "स्थान बदलें" if session.language == "hi" else "Change Location"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": [confirm_sug, change_sug]
                }
            else:
                msg = "Which city?"
                if session.language == "hi":
                    msg = "कौन सा शहर?"
                elif session.language == "hinglish":
                    msg = "Kaun sa city?"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": []
                }
        elif step_str == "CONFIRM_LOCATION" or step_str == "CONFIRM_AUTO_LOCATION":
            if clean_msg in ["confirm", "yes", "correct", "option:confirm", "option:yes", "option:confirm details", "पुष्टि करें", "option:पुष्टि करें"]:
                session.step = "IDENTIFY_ADDRESS"
                district_val = localize_location(session.city, session.language)
                prompt_text = format_message("PROFILE_ADDRESS_REQUEST", session.language, session, {"district": district_val})
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }
            elif clean_msg in ["change location", "no", "option:change location", "option:no", "option:modify details", "स्थान बदलें", "option:स्थान बदलें"]:
                session.city = ""
                session.district = ""
                session.step = "IDENTIFY_LOCATION"
                msg = "Understood. Please tell me your city, district, or area:"
                if session.language == "hi":
                    msg = "ठीक है। कृपया अपना शहर, ज़िला या क्षेत्र बताएं:"
                elif session.language == "hinglish":
                    msg = "Understood. Please apna city, district, ya area batayein:"
                return {
                    "intercepted": True,
                    "response": msg,
                    "suggestions": []
                }
            else:
                extracted = extract_location(message)
                if extracted:
                    session.city = extracted
                    session.district = extracted
                    session.step = "CONFIRM_LOCATION"
                    
                    district_val = localize_location(session.city, session.language)
                    msg = format_message("PROFILE_LOCATION_CONFIRM", session.language, session, {"district": district_val})
                    confirm_sug = "पुष्टि करें" if session.language == "hi" else "Confirm"
                    change_sug = "स्थान बदलें" if session.language == "hi" else "Change Location"
                    return {
                        "intercepted": True,
                        "response": msg,
                        "suggestions": [confirm_sug, change_sug]
                    }
                else:
                    confirm_sug = "पुष्टि करें" if session.language == "hi" else "Confirm"
                    change_sug = "स्थान बदलें" if session.language == "hi" else "Change Location"
                    prompt = "👮 Please confirm your location or choose to change it:\n\n- [Confirm](option:Confirm)\n- [Change Location](option:Change Location)"
                    if session.language == "hi":
                        prompt = f"👮 कृपया अपने स्थान की पुष्टि करें या इसे बदलने का विकल्प चुनें:\n\n- [{confirm_sug}](option:Confirm)\n- [{change_sug}](option:Change Location)"
                    elif session.language == "hinglish":
                        prompt = f"👮 Please location confirm karein ya change karne ka option select karein:\n\n- [{confirm_sug}](option:Confirm)\n- [{change_sug}](option:Change Location)"
                    return {
                        "intercepted": True,
                        "response": prompt,
                        "suggestions": [confirm_sug, change_sug]
                    }
        elif step_str == "IDENTIFY_ADDRESS":
            parsed = parse_full_address(message)
            session.addressLine1 = parsed["addressLine1"]
            session.addressLine2 = parsed["addressLine2"] or ""
            session.pincode = parsed["pincode"] or ""
            session.step = "CONFIRM_PROFILE"
        elif step_str == "CONFIRM_PROFILE":
            if clean_msg in ["yes", "correct", "confirm details", "option:yes", "option:confirm details", "confirm", "विवरण की पुष्टि करें", "option:विवरण की पुष्टि करें"]:
                session.isConfirmed = True
                session.profileConfirmed = True
                
                db_action = {
                    "type": "citizen",
                    "data": {
                        "fullName": session.fullName,
                        "mobileNumber": session.mobileNumber,
                        "email": session.email or None,
                        "addressLine1": session.addressLine1 or None,
                        "addressLine2": session.addressLine2 or None,
                        "city": session.city or None,
                        "district": session.district or None,
                        "state": session.state_name,
                        "pincode": session.pincode or None,
                        "latitude": session.latitude,
                        "longitude": session.longitude,
                        "isConfirmed": True
                    }
                }

                first_name = session.fullName.split()[0] if session.fullName else ""
                first_name_disp = format_name_with_honorific(first_name, session.language)
                full_name_disp = format_name_with_honorific(session.fullName, session.language)
                
                if session.language == "hi":
                    success_txt = (
                        f"👮 नागरिक प्रोफ़ाइल सत्यापित\n\n"
                        f"नाम: {full_name_disp}\n"
                        f"मोबाइल: {session.mobileNumber}\n"
                        f"स्थान: {localize_location(session.city or session.district or 'Lucknow', session.language)}, {session.state_name}\n\n"
                        f"✓ आपके विवरण सफलतापूर्वक दर्ज कर लिए गए हैं।\n\n"
                        f"धन्यवाद, {first_name_disp}।\n\n"
                        f"आइए आपके {session.workflow} के साथ आगे बढ़ें।"
                    )
                elif session.language == "hinglish":
                    success_txt = (
                        f"👮 Citizen Profile Verified\n\n"
                        f"Name: {session.fullName}\n"
                        f"Mobile: {session.mobileNumber}\n"
                        f"Location: {session.city or session.district or 'Lucknow'}, {session.state_name}\n\n"
                        f"✓ Aapki details successfully record ho gayi hain.\n\n"
                        f"Thank you, {first_name}.\n\n"
                        f"Chaliye aapke {session.workflow} ke saath aage badhte hain."
                    )
                else:
                    success_txt = (
                        f"👮 Citizen Profile Verified\n\n"
                        f"Name: {session.fullName}\n"
                        f"Mobile: {session.mobileNumber}\n"
                        f"Location: {session.city or session.district or 'Lucknow'}, {session.state_name}\n\n"
                        f"✓ Your details have been recorded successfully.\n\n"
                        f"Thank you, {first_name}.\n\n"
                        f"Let's continue with your {session.workflow}."
                    )

                # Initialize main active workflow step
                session.step = 0
                fields = self.workflow_fields[session.workflow]
                next_field = fields[0]
                session.step = 1
                session.currentExpectedField = next_field["name"]
                q_text = self._format_question(session, next_field, session.language, 1)

                db_action_list = [db_action]
                log_audit(session, "profile_confirmed", {
                    "fullName": session.fullName,
                    "mobileNumber": session.mobileNumber,
                    "city": session.city,
                    "addressLine1": session.addressLine1
                }, db_action_list)

                return {
                    "intercepted": True,
                    "response": success_txt + "\n\n" + q_text,
                    "suggestions": next_field["suggestions"],
                    "db_action": db_action_list
                }
            elif clean_msg in ["no", "modify", "option:modify details", "modify details"]:
                session.step = "MODIFY_PROFILE_SELECT"
                return {
                    "intercepted": True,
                    "response": "Which profile detail would you like to modify?\n\n- [1. Full Name](option:1)\n- [2. Mobile Number](option:2)\n- [3. Location](option:3)\n- [4. Complete Address](option:4)",
                    "suggestions": ["1", "2", "3", "4"]
                }
        elif step_str == "MODIFY_PROFILE_SELECT":
            choice = clean_msg
            if "name" in choice or "1" in choice:
                session.step = "MODIFY_PROFILE_INPUT"
                session.currentExpectedField = "fullName"
                return {
                    "intercepted": True,
                    "response": "Please enter your correct full name:",
                    "suggestions": []
                }
            elif "mobile" in choice or "2" in choice or "number" in choice:
                session.step = "MODIFY_PROFILE_INPUT"
                session.currentExpectedField = "mobileNumber"
                return {
                    "intercepted": True,
                    "response": "Please enter your correct mobile number:",
                    "suggestions": []
                }
            elif "location" in choice or "3" in choice:
                session.step = "MODIFY_PROFILE_INPUT"
                session.currentExpectedField = "city"
                return {
                    "intercepted": True,
                    "response": "Please enter your correct location (city/district):",
                    "suggestions": []
                }
            elif "address" in choice or "4" in choice:
                session.step = "MODIFY_PROFILE_INPUT"
                session.currentExpectedField = "addressLine1"
                return {
                    "intercepted": True,
                    "response": "Please enter your complete address:",
                    "suggestions": []
                }
            else:
                return {
                    "intercepted": True,
                    "response": "I may not have understood correctly. Could you please select a valid option to modify:\n\n- [1. Full Name](option:1)\n- [2. Mobile Number](option:2)\n- [3. Location](option:3)\n- [4. Complete Address](option:4)",
                    "suggestions": ["1", "2", "3", "4"]
                }
        elif step_str == "MODIFY_PROFILE_INPUT":
            # Extract fields directly from natural language input
            updated = False
            db_action_list = []
            
            # 1. Phone number check
            phone_matches = re.findall(r"(?:mobile|number|phone|change mobile to|change number to)\s+(?:is\s+)?((?:\+91[\s-]?)?[6-9]\d{9}|\b[6-9]\d{9}\b)", message, re.IGNORECASE)
            if not phone_matches:
                # Fallback to direct 10-digit number match in message
                phone_matches = re.findall(r"(?:\+91[\s-]?)?[6-9]\d{9}|\b[6-9]\d{9}\b", message)
            if phone_matches:
                norm = normalize_mobile(phone_matches[0])
                if norm and validate_mobile(norm):
                    session.mobileNumber = norm
                    log_audit(session, "profile_field_modified", {"field": "mobileNumber", "value": session.mobileNumber}, db_action_list)
                    updated = True

            # 2. Name check
            name_matches = re.search(r"(?:name is|change name to|my name is)\s+([a-zA-Z\u0900-\u097F\s'-]+)", message, re.IGNORECASE)
            if name_matches and name_matches.group(1):
                potential_name = name_matches.group(1).strip()
                if validate_name(potential_name):
                    session.fullName = potential_name
                    log_audit(session, "profile_field_modified", {"field": "fullName", "value": session.fullName}, db_action_list)
                    updated = True

            # 3. Location check
            loc_matches = re.search(r"(?:live in|change location to|change my location to|district is|location is|my district is)\s+([a-zA-Z\u0900-\u097F\s'-]+)", message, re.IGNORECASE)
            if not loc_matches:
                # Try generic location extraction from words
                extracted_loc = extract_location(message)
                if extracted_loc:
                    session.city = extracted_loc
                    session.district = extracted_loc
                    log_audit(session, "profile_field_modified", {"field": "city", "value": session.city}, db_action_list)
                    updated = True
            elif loc_matches and loc_matches.group(1):
                potential_loc = loc_matches.group(1).strip()
                if len(potential_loc) >= 3:
                    session.city = potential_loc
                    session.district = potential_loc
                    log_audit(session, "profile_field_modified", {"field": "city", "value": session.city}, db_action_list)
                    updated = True

            # 4. If address is explicitly entered
            if not updated and len(message.strip()) > 15:
                parsed = parse_full_address(message)
                session.addressLine1 = parsed["addressLine1"]
                session.addressLine2 = parsed["addressLine2"] or ""
                session.pincode = parsed["pincode"] or ""
                log_audit(session, "profile_field_modified", {"field": "address", "value": message}, db_action_list)
                updated = True

            if not updated:
                return {
                    "intercepted": True,
                    "response": "I didn't capture the updated details. Could you please specify clearly? (e.g. \"My name is Mohan Singh\", \"Change my number to 9876543210\", \"I live in Kanpur\")",
                    "suggestions": []
                }

            session.step = "CONFIRM_PROFILE"
            return self.render_confirmation_card(session)

        # Check for missing inputs
        if not session.mobileNumber and not session.fullName:
            session.step = "IDENTIFY_MOBILE_FIRST"
            prompt_text = format_message("PROFILE_MOBILE_FIRST_REQUEST", session.language, session)
            return {
                "intercepted": True,
                "response": prompt_text,
                "suggestions": []
            }

        if not session.fullName:
            session.step = "IDENTIFY_NAME"
            prompt_text = format_message("PROFILE_NAME_REQUEST", session.language, session)
            return {
                "intercepted": True,
                "response": prompt_text,
                "suggestions": []
            }

        if not session.mobileNumber:
            session.step = "IDENTIFY_MOBILE"
            full_name_disp = format_name_with_honorific(session.fullName, session.language)
            prompt_text = format_message("PROFILE_MOBILE_REQUEST", session.language, session, {"name": full_name_disp})
            if session.data.get("name_suggest_flag"):
                suggest_text = "*(Polite Suggestion: Providing a full name with surname is recommended for official records, but we can proceed.)*\n\n"
                if session.language == "hi":
                    suggest_text = "*(सुझाव: आधिकारिक अभिलेखों के लिए पूरा नाम देना उपयोगी होता है, लेकिन हम आगे बढ़ सकते हैं।)*\n\n"
                elif session.language == "hinglish":
                    suggest_text = "*(Suggestion: Official records ke liye surname ke saath full name dena sahi rehta hai, par hum aage badh sakte hain.)*\n\n"
                prompt_text = suggest_text + prompt_text
                session.data["name_suggest_flag"] = False
            return {
                "intercepted": True,
                "response": prompt_text,
                "suggestions": []
            }

        if not session.city and not session.district:
            if session.latitude and session.longitude:
                session.city = "Lucknow"
                session.district = "Lucknow"
                session.step = "CONFIRM_AUTO_LOCATION"
                
                district_val = localize_location(session.city, session.language)
                prompt_text = format_message("PROFILE_LOCATION_CONFIRM", session.language, session, {"district": district_val})
                confirm_sug = "पुष्टि करें" if session.language == "hi" else "Confirm"
                change_sug = "स्थान बदलें" if session.language == "hi" else "Change Location"
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": [confirm_sug, change_sug]
                }
            else:
                session.step = "IDENTIFY_LOCATION"
                prompt_text = format_message("PROFILE_LOCATION_REQUEST", session.language, session)
                return {
                    "intercepted": True,
                    "response": prompt_text,
                    "suggestions": []
                }

        if not session.addressLine1:
            session.step = "IDENTIFY_ADDRESS"
            district_val = localize_location(session.city, session.language)
            prompt_text = format_message("PROFILE_ADDRESS_REQUEST", session.language, session, {"district": district_val})
            return {
                "intercepted": True,
                "response": prompt_text,
                "suggestions": []
            }

        session.step = "CONFIRM_PROFILE"
        return self.render_confirmation_card(session)

    def _format_question(self, session: WorkflowSession, field: dict, language: str, step: int) -> str:
        workflow = session.workflow
        transitions = {
            "en": ["Let's start with your details.", "Thank you. ", "Got it. ", "Perfect. ", "Thank you. "],
            "hi": ["आइए आपकी जानकारी से शुरू करते हैं।", "धन्यवाद। ", "ठीक है। ", "बहुत बढ़िया। ", "धन्यवाद। "],
            "hinglish": ["Aapki details se shuru karte hain.", "Thank you. ", "Got it. ", "Perfect. ", "Thank you. "]
        }
        prefix_phrase = ""
        if step > 1:
            idx = min(step - 1, len(transitions[language]) - 1)
            prefix_phrase = transitions[language][idx]

        empathy_prepend = ""
        if workflow == "complaint" and field["name"] in ["mobile_brand", "incident_location"] and not session.data.get("empathy_shown"):
            comp_type = session.data.get("complaint_type")
            empathy_key = f"EMPATHY_{comp_type}"
            empathy_text = format_message(empathy_key, language, session)
            if empathy_text != empathy_key:
                session.data["empathy_shown"] = True
                if comp_type == "LOST_MOBILE":
                    return empathy_text
                else:
                    empathy_prepend = empathy_text + "\n\n"

        field_questions = {
            "complaint": {
                "complaint_type": {
                    "en": "Please select the **Complaint Type**:\n\n- [Lost Mobile / Theft](option:Lost Mobile / Theft)\n- [Lost Document](option:Lost Document)\n- [Simple Harassment](option:Simple Harassment)\n- [Cyber Fraud / Financial Loss](option:Cyber Fraud / Financial Loss)",
                    "hi": "कृपया **शिकायत का प्रकार** चुनें:\n\n- [मोबाइल चोरी / गुम होना](option:Lost Mobile / Theft)\n- [खोया हुआ दस्तावेज़](option:Lost Document)\n- [सामान्य उत्पीड़न](option:Simple Harassment)\n- [साइबर धोखाधड़ी](option:Cyber Fraud / Financial Loss)",
                    "hinglish": "Please select the **Complaint Type**:\n\n- [Lost Mobile / Theft](option:Lost Mobile / Theft)\n- [Lost Document](option:Lost Document)\n- [Simple Harassment](option:Simple Harassment)\n- [Cyber Fraud / Financial Loss](option:Cyber Fraud / Financial Loss)"
                },
                "incident_location": {
                    "en": "Could you please tell me where the incident occurred?",
                    "hi": "क्या आप कृपया बता सकते हैं कि घटना कहाँ हुई थी?",
                    "hinglish": "Kya aap please bata sakte hain ki incident kahan hua tha?"
                },
                "incident_time": {
                    "en": "Could you tell me when did the incident occur (date in DD/MM/YYYY)?",
                    "hi": "क्या आप बता सकते हैं कि घटना कब (दिनांक DD/MM/YYYY) हुई थी?",
                    "hinglish": "Kya aap bata sakte hain ki incident kab (date DD/MM/YYYY) hua?"
                },
                "incident_description": {
                    "en": "Could you briefly describe what happened?",
                    "hi": "क्या आप संक्षेप में बता सकते हैं कि क्या हुआ था?",
                    "hinglish": "Kya aap short mein describe kar sakte hain ki kya हुआ था?"
                },
                "mobile_brand": {
                    "en": "What is the **Mobile Brand**?\n- [Samsung](option:Samsung)\n- [Apple](option:Apple)\n- [Xiaomi](option:Xiaomi)\n- [Realme](option:Realme)\n- [OnePlus](option:OnePlus)\n- [Vivo](option:Vivo)\n- [Oppo](option:Oppo)",
                    "hi": "मोबाइल का **ब्रांड** क्या है?\n- [Samsung](option:Samsung)\n- [Apple](option:Apple)\n- [Xiaomi](option:Xiaomi)\n- [Realme](option:Realme)\n- [OnePlus](option:OnePlus)\n- [Vivo](option:Vivo)\n- [Oppo](option:Oppo)",
                    "hinglish": "Mobile ka **Brand** kya hai?\n- [Samsung](option:Samsung)\n- [Apple](option:Apple)\n- [Xiaomi](option:Xiaomi)\n- [Realme](option:Realme)\n- [OnePlus](option:OnePlus)\n- [Vivo](option:Vivo)\n- [Oppo](option:Oppo)"
                },
                "mobile_model": {
                    "en": "What is the **Mobile Model**?\nExample: Galaxy A54, iPhone 14",
                    "hi": "मोबाइल का **मॉडल** क्या है?\nउदाहरण: Galaxy A54, iPhone 14",
                    "hinglish": "Mobile ka **Model** kya hai?\nExample: Galaxy A54, iPhone 14"
                },
                "mobile_color": {
                    "en": "What is the **Color** of the mobile phone?",
                    "hi": "मोबाइल फोन का **रंग** क्या है?",
                    "hinglish": "Mobile phone ka **Color** kya hai?"
                },
                "purchase_year": {
                    "en": "What is the **Purchase Year** of the mobile?\nExample: 2024",
                    "hi": "मोबाइल **किस वर्ष में खरीदा** गया था?\nउदाहरण: 2024",
                    "hinglish": "Mobile ka **Purchase Year** kya hai?\nExample: 2024"
                },
                "imei_number": {
                    "en": "Do you know your IMEI number?\n\nYou can usually find it:\n• On the phone box\n• On the purchase invoice\n• By dialing *#06# if the device is available\n\nIf you do not have it, type:\n**Skip**",
                    "hi": "क्या आप अपना IMEI नंबर जानते हैं?\n\nआप इसे पा सकते हैं:\n• फोन के बॉक्स पर\n• खरीद चालान (invoice) पर\n• यदि डिवाइस उपलब्ध है, तो *#06# डायल करके\n\nयदि आपके पास यह नहीं है, तो टाइप करें:\n**Skip**",
                    "hinglish": "Do you know your IMEI number?\n\nAap isse find kar sakte hain:\n• Phone box par\n• Purchase invoice par\n• Dial *#06# agar device available hai\n\nAgar aapke paas nahi hai, toh type karein:\n**Skip**",
                }
            },
            "verification": {
                "verification_type": {
                    "en": "Please select the **Verification Type**:\n\n- [Tenant Verification](option:Tenant Verification)\n- [PG Verification](option:PG Verification)\n- [Domestic Help Verification](option:Domestic Help Verification)\n- [Employee Verification](option:Employee Verification)",
                    "hi": "कृपया **सत्यापन का प्रकार** चुनें:\n\n- [किरायेदार सत्यापन](option:Tenant Verification)\n- [पीजी सत्यापन](option:PG Verification)\n- [घरेलू सहायक सत्यापन](option:Domestic Help Verification)\n- [कर्मचारी सत्यापन](option:Employee Verification)",
                    "hinglish": "Please select the **Verification Type**:\n\n- [Tenant Verification](option:Tenant Verification)\n- [PG Verification](option:PG Verification)\n- [Domestic Help Verification](option:Domestic Help Verification)\n- [Employee Verification](option:Employee Verification)"
                },
                "name": {
                    "en": "What is the full name of the candidate being verified?",
                    "hi": "सत्यापित किए जाने वाले व्यक्ति का पूरा नाम क्या है?",
                    "hinglish": "Satyapit hone wale candidate ka full name kya hai?"
                },
                "address": {
                    "en": "What is their permanent address?",
                    "hi": "उनका स्थायी पता क्या है?",
                    "hinglish": "Unka permanent address kya hai?"
                },
                "mobile": {
                    "en": "Could you please share their mobile number?",
                    "hi": "क्या आप कृपया उनका मोबाइल नंबर साझा कर सकते हैं?",
                    "hinglish": "Kya aap unka mobile number share karenge?"
                },
                "property_details": {
                    "en": "Could you provide the property details (flat number, block, city) where they will reside?",
                    "hi": "क्या आप संपत्ति का विवरण (जैसे फ्लैट नंबर, ब्लॉक और शहर) दे सकते हैं जहाँ वे रहेंगे?",
                    "hinglish": "Kya aap property details (flat number, block, city) batayenge jahan wo rahenge?"
                }
            },
            "certificate": {
                "name": {
                    "en": "What is your full name?",
                    "hi": "आपका पूरा नाम क्या है?",
                    "hinglish": "Aapka full name kya hai?"
                },
                "address": {
                    "en": "What is your permanent address?",
                    "hi": "आपका स्थायी पता क्या है?",
                    "hinglish": "Aapka permanent address kya hai?"
                },
                "district": {
                    "en": "Which district in Uttar Pradesh are you applying from?",
                    "hi": "आप उत्तर प्रदेश के किस ज़िले से आवेदन कर रहे हैं?",
                    "hinglish": "Aap Uttar Pradesh ke kis district se apply kar rahe hain?"
                },
                "purpose": {
                    "en": "What is the purpose of this certificate?\n\n- [Job Application](option:Job Application)\n- [Passport](option:Passport)\n- [Visa](option:Visa)\n- [Higher Education](option:Higher Education)\n- [Government Service](option:Government Service)",
                    "hi": "इस प्रमाण पत्र का उद्देश्य क्या है?\n\n- [Job Application](option:Job Application)\n- [Passport](option:Passport)\n- [Visa](option:Visa)",
                    "hinglish": "Is certificate ka purpose kya hai?\n\n- [Job Application](option:Job Application)\n- [Passport](option:Passport)\n- [Visa](option:Visa)"
                }
            },
            "event": {
                "event_type": {
                    "en": "Please select the **Request Type**:\n\n- [Event Permission](option:Event Permission)\n- [Procession Request](option:Procession Request)\n- [Protest Request](option:Protest Request)\n- [Film Shooting Request](option:Film Shooting Request)",
                    "hi": "कृपया **अनुरोध का प्रकार** चुनें:\n\n- [कार्यक्रम अनुमति](option:Event Permission)\n- [जुलूस अनुमति](option:Procession Request)\n- [विरोध प्रदर्शन](option:Protest Request)\n- [फिल्म शूटिंग](option:Film Shooting Request)",
                    "hinglish": "Please select the **Request Type**:\n\n- [Event Permission](option:Event Permission)\n- [Procession Request](option:Procession Request)\n- [Protest Request](option:Protest Request)\n- [Film Shooting Request](option:Film Shooting Request)"
                },
                "event_name": {
                    "en": "What is the name of your event?\nExample: Independence Day Cultural Program",
                    "hi": "आपके कार्यक्रम का नाम क्या है?",
                    "hinglish": "Aapke event ka naam kya hai?"
                },
                "location": {
                    "en": "Could you also tell me where the event will take place (location or route)?",
                    "hi": "क्या आप बता सकते हैं कि कार्यक्रम कहाँ (स्थान या मार्ग) आयोजित होगा?",
                    "hinglish": "Event kahan (location/route) hone wala hai?"
                },
                "date": {
                    "en": "On what date is the event scheduled (DD/MM/YYYY)?",
                    "hi": "कार्यक्रम किस तिथि (DD/MM/YYYY) को निर्धारित है?",
                    "hinglish": "Event किस date (DD/MM/YYYY) ko hone wala hai?"
                },
                "expected_attendance": {
                    "en": "Could you tell me what the expected attendance number is?\nExample: 500",
                    "hi": "क्या आप बता सकते हैं कि कार्यक्रम में संभावित उपस्थिति संख्या कितनी है?",
                    "hinglish": "Event mein expected attendance kitni hai?"
                }
            },
            "tracking": {
                "reference_number": {
                    "en": "Please provide your Application Reference Number for tracking (e.g. UP-CMP-2026-123456):",
                    "hi": "कृपया ट्रैकिंग के लिए अपनी आवेदन संदर्भ संख्या प्रदान करें (उदा. UP-CMP-2026-123456):",
                    "hinglish": "Please track karne ke liye apna Application Reference Number batayein (jaise UP-CMP-2026-123456):"
                }
            }
        }

        f_name = field["name"]
        q_text = field_questions.get(workflow, {}).get(f_name, {}).get(language, field["label"])
        
        if field.get("suggestions") and not f_name.endswith("_type") and f_name != "purpose":
            options_text = "\n\nSelect option / विकल्प चुनें:\n"
            for sug in field["suggestions"]:
                options_text += f"- [{sug}](option:{sug})\n"
            q_text += options_text

        return f"{empathy_prepend}{prefix_phrase}{q_text}"

    def _finalize_workflow(self, session: WorkflowSession) -> dict:
        workflow = session.workflow
        data = session.data
        citizen_id = session.citizenId or "default-citizen-id"
        
        # Note: Do not clear the state here because we need it to generate the response text below.
        # We will clear the state right before returning.
        
        year = 2026
        random_id = random.randint(100000, 999999)
        db_action = None
        db_action_list = []
        
        if workflow == "complaint":
            ref_num = f"UP-CMP-{year}-{random_id:06d}"
            session.referenceNumber = ref_num
            details = f"Location: {data.get('incident_location')} | Time: {data.get('incident_time')} | Desc: {data.get('incident_description')}"
            db_action = {
                "type": "complaint",
                "data": {
                    "type": data.get("complaint_type"),
                    "details": details,
                    "refNum": ref_num,
                    "citizenId": citizen_id,
                    "mobileBrand": data.get("mobile_brand"),
                    "mobileModel": data.get("mobile_model"),
                    "mobileColor": data.get("mobile_color"),
                    "purchaseYear": int(data.get("purchase_year")) if str(data.get("purchase_year")).isdigit() else None,
                    "imeiNumber": data.get("imei_number") if data.get("imei_number") and data.get("imei_number").strip().lower() not in ["skip", "skip / छोड़ें", "chodein", "none", "not available", "i don't know", "no"] else "Not Provided"
                }
            }
            # Format date dynamically
            current_date = datetime.now().strftime("%d/%m/%Y")
            resp_str = (
                f"👮 **Complaint Registered Successfully**\n\n"
                f"Reference Number:\n**{ref_num}**\n\n"
                f"Complaint Type:\n**{data.get('complaint_type')}**\n\n"
                f"Status:\n**Submitted**\n\n"
                f"Date:\n**{current_date}**\n\n"
                f"You can use this reference number to track your complaint.\n\n"
                f"- [Track Application](option:Track Application)\n"
                f"- [Download Receipt](option:Download Receipt)\n"
                f"- [Start New Request](option:Start New Request)"
            )
            sugs = ["Track Application", "Download Receipt", "Start New Request"]
        elif workflow == "verification":
            ref_num = f"UP-TV-{year}-{random_id:06d}"
            session.referenceNumber = ref_num
            db_action = {
                "type": "verification",
                "data": {
                    "type": data.get("verification_type"),
                    "name": data.get("name"),
                    "address": data.get("address"),
                    "mobile": data.get("mobile"),
                    "propertyDetails": data.get("property_details") or data.get("address"),
                    "refNum": ref_num,
                    "citizenId": citizen_id
                }
            }
            resp_str = (
                f"👮 **Verification Request Registered Successfully**\n\n"
                f"Reference Number:\n**{ref_num}**\n\n"
                f"Verification Type:\n**{data.get('verification_type')}**\n\n"
                f"Candidate Name:\n**{data.get('name')}**\n\n"
                f"Status:\n**Submitted**\n\n"
                f"You can use this reference number to track your application.\n\n"
                f"- [Track Application](option:Track Application)\n"
                f"- [Download Receipt](option:Download Receipt)\n"
                f"- [Start New Request](option:Start New Request)"
            )
            sugs = ["Track Application", "Download Receipt", "Start New Request"]
        elif workflow == "certificate":
            ref_num = f"UP-CC-{year}-{random_id:06d}"
            session.referenceNumber = ref_num
            db_action = {
                "type": "certificate",
                "data": {
                    "name": data.get("name"),
                    "address": data.get("address"),
                    "district": data.get("district"),
                    "purpose": data.get("purpose"),
                    "refNum": ref_num,
                    "citizenId": citizen_id,
                    "usedProfileReuse": data.get("isSelf") == True,
                    "isSelf": data.get("isSelf") == True
                }
            }
            resp_str = (
                f"👮 **Character Certificate Requested Successfully**\n\n"
                f"Reference Number:\n**{ref_num}**\n\n"
                f"Status:\n**Submitted**\n\n"
                f"You can use this reference number to track your application.\n\n"
                f"- [Track Application](option:Track Application)\n"
                f"- [Download Receipt](option:Download Receipt)\n"
                f"- [Start New Request](option:Start New Request)"
            )
            sugs = ["Track Application", "Download Receipt", "Start New Request"]
        elif workflow == "event":
            ref_num = f"UP-EP-{year}-{random_id:06d}"
            session.referenceNumber = ref_num
            db_action = {
                "type": "event",
                "data": {
                    "type": data.get("event_type"),
                    "name": data.get("event_name"),
                    "location": data.get("location"),
                    "date": data.get("date"),
                    "attendance": int(data.get("expected_attendance")) if str(data.get("expected_attendance")).isdigit() else 100,
                    "refNum": ref_num,
                    "citizenId": citizen_id,
                    "organizerName": data.get("organizerName"),
                    "organizerAddress": data.get("organizerAddress"),
                    "organizerMobile": data.get("organizerMobile"),
                    "organizerIsApplicant": data.get("organizerIsApplicant") != False,
                    "usedProfileReuse": data.get("organizerIsApplicant") != False,
                    "isSelf": data.get("organizerIsApplicant") != False
                }
            }
            resp_str = (
                f"👮 **Event Permission Requested Successfully**\n\n"
                f"Reference Number:\n**{ref_num}**\n\n"
                f"Status:\n**Submitted**\n\n"
                f"You can use this reference number to track your application.\n\n"
                f"- [Track Application](option:Track Application)\n"
                f"- [Download Receipt](option:Download Receipt)\n"
                f"- [Start New Request](option:Start New Request)"
            )
            sugs = ["Track Application", "Download Receipt", "Start New Request"]
        else:
            # Fallback formatting for other services
            ref_num = f"UP-{workflow[:3].upper()}-{year}-{random_id:06d}"
            session.referenceNumber = ref_num
            resp_str = (
                f"👮 **Request Registered Successfully**\n\n"
                f"Reference Number:\n**{ref_num}**\n\n"
                f"Status:\n**Submitted**\n\n"
                f"- [Track Application](option:Track Application)\n"
                f"- [Download Receipt](option:Download Receipt)\n"
                f"- [Start New Request](option:Start New Request)"
            )
            sugs = ["Track Application", "Download Receipt", "Start New Request"]
            
        if db_action:
            db_action_list.append(db_action)
            
        log_audit(session, "workflow_submitted", {
            "workflow": workflow,
            "referenceNumber": ref_num
        }, db_action_list)

        # Reset session state to FEEDBACK_COLLECTION for feedback prompts
        session.workflow = None
        session.step = "ASK_FEEDBACK"
        session.data = {}
        session.currentWorkflowState = "FEEDBACK_COLLECTION"
        session.currentExpectedField = ""

        # Localized feedback ask prompt
        feedback_ask_prompt = format_message("FEEDBACK_ASK", session.language, session)
        resp_str = f"{resp_str}\n\n{feedback_ask_prompt}"
        
        if session.language == "hi":
            rating_sugs = ["5 - बहुत मददगार", "4 - मददगार", "3 - सामान्य", "2 - सुधार की आवश्यकता", "1 - मददगार नहीं"]
        else:
            rating_sugs = ["5 - Very Helpful", "4 - Helpful", "3 - Neutral", "2 - Needs Improvement", "1 - Not Helpful"]

        return {
            "intercepted": True,
            "response": resp_str,
            "suggestions": rating_sugs,
            "db_action": db_action_list
        }

    def get_localized_suggestions_list(self, lang: str, retrieved_context: list = None) -> list[str]:
        # Default options
        if lang == "hi":
            suggestions = ["🚔 शिकायत दर्ज करें", "🏠 किरायेदार सत्यापन", "📜 चरित्र प्रमाण पत्र", "🔍 आवेदन की स्थिति"]
        elif lang == "hinglish":
            suggestions = ["🚔 File Complaint", "🏠 Tenant Verification", "📜 Character Certificate", "🔍 Track Application"]
        else:
            suggestions = ["🚔 File Complaint", "🏠 Tenant Verification", "📜 Character Certificate", "🔍 Track Application"]
            
        if retrieved_context:
            try:
                first_item = retrieved_context[0]
                cat = ""
                if isinstance(first_item, dict):
                    cat = first_item.get("category", "")
                else:
                    cat = getattr(first_item, "category", "")
                    
                if cat == "Postmortem Report Request":
                    if lang == "hi":
                        suggestions = ["पोस्टमार्टम के बारे में पूछें", "🚔 शिकायत दर्ज करें", "मुख्य डैशबोर्ड"]
                    elif lang == "hinglish":
                        suggestions = ["Postmortem ke baare mein poochein", "🚔 File Complaint", "Main Dashboard"]
                    else:
                        suggestions = ["Ask about Postmortem", "🚔 File Complaint", "Main Dashboard"]
                elif cat == "Character Certificate":
                    if lang == "hi":
                        suggestions = ["📜 चरित्र प्रमाण पत्र", "🔍 आवेदन की स्थिति", "मुख्य डैशबोर्ड"]
                    elif lang == "hinglish":
                        suggestions = ["📜 Character Certificate", "🔍 Track Application", "Main Dashboard"]
                    else:
                        suggestions = ["📜 Character Certificate", "🔍 Track Application", "Main Dashboard"]
                elif cat == "Tenant Verification":
                    if lang == "hi":
                        suggestions = ["🏠 किरायेदार सत्यापन", "पीजी सत्यापन", "मुख्य डैशबोर्ड"]
                    elif lang == "hinglish":
                        suggestions = ["🏠 Tenant Verification", "PG Verification", "Main Dashboard"]
                    else:
                        suggestions = ["🏠 Tenant Verification", "PG Verification", "Main Dashboard"]
            except Exception as e:
                print(f"Error parsing retrieved context in suggestions list: {e}")
                    
        return suggestions
