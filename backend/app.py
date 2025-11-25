from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
import logging
import os
import time
from PIL import Image
import numpy as np
from deepface import DeepFace
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ==================== ENVIRONMENT VARIABLES ====================
OWNER_EMAIL = os.getenv('OWNER_EMAIL')
OWNER_PHONE = "+916309766520"
ALERT_EMAIL = os.getenv('ALERT_EMAIL', OWNER_EMAIL)  # Email to receive alerts (defaults to OWNER_EMAIL if not set)
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
# ======== HARD-CODED TWILIO CONFIG ========
TWILIO_ACCOUNT_SID = "AC96ea983fd4fa3384851e2885763e6628"
TWILIO_AUTH_TOKEN = "83f1aa00ba11b6f585f136ca633ab692"
TWILIO_PHONE_NUMBER = "+12677035819"


# ==================== EXISTING EMOTION DETECTION ====================

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'alankara-ai-backend',
        'endpoints': ['/detect-emotion', '/send-alert', '/security-test']
    }), 200

@app.route('/detect-emotion', methods=['POST'])
def detect_emotion():
    """
    Detect emotion from base64 encoded image
    
    Expected: { "image": "data:image/jpeg;base64,..." }
    Returns: { "emotion": "happy|neutral|sad", "confidence": 0.85 }
    """
    start_time = time.time()
    
    try:
        if not request.json or 'image' not in request.json:
            return jsonify({'error': 'Missing image data'}), 400
        
        # Decode base64 image
        img_data_url = request.json['image']
        img_base64 = img_data_url.split(',')[1] if ',' in img_data_url else img_data_url
        
        img_bytes = base64.b64decode(img_base64)
        img = Image.open(io.BytesIO(img_bytes))
        
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        img_array = np.array(img)
        
        # Analyze with DeepFace
        result = DeepFace.analyze(
            img_path=img_array,
            actions=['emotion'],
            enforce_detection=False,
            detector_backend='opencv',
            silent=True
        )
        
        if isinstance(result, list):
            result = result[0]
        
        emotions = result.get('emotion', {})
        
        # Map to 3 categories: happy, neutral, sad
        emotion_mapping = {
            'happy': float(emotions.get('happy', 0)),
            'neutral': float(emotions.get('neutral', 0)),
            'sad': float(
                emotions.get('sad', 0) + 
                emotions.get('angry', 0) * 0.5 + 
                emotions.get('fear', 0) * 0.3
            )
        }
        
        # Get dominant emotion
        dominant_emotion = max(emotion_mapping, key=emotion_mapping.get)
        confidence = round(emotion_mapping[dominant_emotion], 2)
        
        processing_time = round((time.time() - start_time) * 1000, 2)
        
        logger.info(f"Emotion: {dominant_emotion} ({confidence}%) - {processing_time}ms")
        
        return jsonify({
            'emotion': dominant_emotion,
            'confidence': confidence,
            'processing_time_ms': processing_time
        }), 200
        
    except Exception as e:
        logger.error(f"Error: {e}")
        return jsonify({
            'emotion': 'neutral',
            'confidence': 0.5,
            'error': str(e)
        }), 200

# ==================== NEW SECURITY ALERT FUNCTIONALITY ====================

def send_email_alert(detection_type, image_base64, timestamp):
    """
    Send email alert with security image
    
    Args:
        detection_type: 'motion' or 'face'
        image_base64: Base64 encoded image
        timestamp: ISO timestamp string
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        from email.mime.image import MIMEImage
        
        if not all([SMTP_USER, SMTP_PASS, ALERT_EMAIL]):
            logger.error("❌ Email configuration missing")
            return False
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = SMTP_USER
        msg['To'] = ALERT_EMAIL  # ✅ Fixed: Now sends to ALERT_EMAIL instead of OWNER_EMAIL
        msg['Subject'] = f"🚨 Security Alert - {'Face Detected' if detection_type == 'face' else 'Motion Detected'}"
        
        # Email body
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">
            <h2 style="color: #d32f2f;">🚨 Security Alert</h2>
            <p><strong>Alert Type:</strong> {detection_type.upper()} DETECTED</p>
            <p><strong>Time:</strong> {timestamp}</p>
            <p><strong>Location:</strong> Alankara AI Kiosk</p>
            <hr>
            <p>{"⚠️ <strong>Intruder Alert:</strong> A face has been detected at your kiosk location." if detection_type == 'face' else "ℹ️ Motion has been detected at your kiosk location."}</p>
            <p>Please check the attached image and take appropriate action if necessary.</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">
                This is an automated alert from your Alankara AI Security System.
            </p>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(body, 'html'))
        
        # Attach image
        try:
            img_data = image_base64.split(',')[1] if ',' in image_base64 else image_base64
            img_bytes = base64.b64decode(img_data)
            
            image = MIMEImage(img_bytes, name=f"security_{detection_type}_{timestamp.replace(':', '-')}.jpg")
            msg.attach(image)
        except Exception as img_error:
            logger.error(f"⚠️ Error attaching image: {img_error}")
        
        # Send email
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
        server.quit()
        
        logger.info(f"✅ Email sent successfully to {ALERT_EMAIL}")  # ✅ Fixed: Log shows correct recipient
        return True
        
    except Exception as e:
        logger.error(f"❌ Email error: {e}")
        return False

def make_twilio_call(detection_type):
    """
    Make Twilio voice call to owner
    
    Args:
        detection_type: 'motion' or 'face'
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, OWNER_PHONE]):
            logger.warning("⚠️ Twilio configuration missing - skipping call")
            return False
        
        from twilio.rest import Client
        
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        # Voice message based on detection type
        if detection_type == 'face':
            message = "Alert! There is someone intruding in your office. Please check your Alankara AI kiosk immediately."
        else:
            message = "Security alert. Motion has been detected at your Alankara AI kiosk location."
        
        # Create TwiML for voice message
        twiml = f"""
        <Response>
            <Say voice="alice" language="en-US">{message}</Say>
            <Pause length="1"/>
            <Say voice="alice" language="en-US">This is an automated security alert from Alankara AI.</Say>
        </Response>
        """
        
        call = client.calls.create(
            twiml=twiml,
            to=OWNER_PHONE,
            from_=TWILIO_PHONE_NUMBER
        )
        
        logger.info(f"✅ Twilio call initiated: {call.sid}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Twilio error: {e}")
        return False

@app.route('/send-alert', methods=['POST'])
def send_alert():
    """
    Handle security alert request
    
    Expected JSON:
    {
        "type": "motion" | "face",
        "image": "data:image/jpeg;base64,...",
        "timestamp": "2024-11-20T10:30:00Z",
        "make_call": true | false  # NEW: controls whether to make Twilio call
    }
    
    Returns:
    {
        "success": true,
        "email_sent": true,
        "call_made": true
    }
    """
    try:
        data = request.json
        
        if not data or 'type' not in data or 'image' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: type, image'
            }), 400
        
        detection_type = data['type']
        image_base64 = data['image']
        timestamp = data.get('timestamp', time.strftime('%Y-%m-%d %H:%M:%S'))
        make_call = data.get('make_call', True)  # Default to True for backward compatibility
        
        logger.info(f"📨 Processing {detection_type} alert at {timestamp} (make_call: {make_call})")
        
        # ALWAYS send email - this happens every time regardless of cooldown
        email_sent = send_email_alert(detection_type, image_base64, timestamp)
        
        # Only make Twilio call if frontend says it's okay (respects cooldown period)
        call_made = False
        if make_call:
            call_made = make_twilio_call(detection_type)
            if call_made:
                logger.info(f"✅ Twilio call made for {detection_type} detection")
            else:
                logger.warning(f"⚠️ Twilio call failed for {detection_type} detection")
        else:
            logger.info(f"📵 Twilio call skipped for {detection_type} detection (cooldown active)")
        
        return jsonify({
            'success': True,
            'email_sent': email_sent,
            'call_made': call_made,
            'timestamp': timestamp
        }), 200
        
    except Exception as e:
        logger.error(f"❌ Alert error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
@app.route('/security-test', methods=['GET'])
def security_test():
    """Test endpoint to verify security configuration"""
    config_status = {
        'owner_email': '✅' if OWNER_EMAIL else '❌ Missing',
        'alert_email': f'✅ {ALERT_EMAIL}' if ALERT_EMAIL else '❌ Missing',
        'owner_phone': '✅' if OWNER_PHONE else '❌ Missing',
        'smtp_configured': '✅' if all([SMTP_USER, SMTP_PASS]) else '❌ Missing',
        'twilio_configured': '✅' if all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]) else '⚠️ Optional'
    }
    
    all_configured = all(value.startswith('✅') or value.startswith('⚠️') for value in config_status.values())
    
    return jsonify({
        'status': 'ready' if all_configured else 'incomplete',
        'configuration': config_status,
        'message': 'All systems ready for security alerts' if all_configured else 'Please configure missing environment variables'
    }), 200

# ==================== SERVER STARTUP ====================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"🚀 Starting Alankara AI Backend on port {port}")
    logger.info(f"📧 Email configured: {bool(SMTP_USER and SMTP_PASS)} -> {ALERT_EMAIL}")
    logger.info(f"📞 Twilio configured: {bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)}")
    app.run(host='0.0.0.0', port=port, debug=False)