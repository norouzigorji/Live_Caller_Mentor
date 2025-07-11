/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Chat } from "@google/genai";

// -- UI Elements --
const callButton = document.getElementById('call-button') as HTMLButtonElement;
const callIcon = document.getElementById('call-icon') as HTMLElement;
const endCallIcon = document.getElementById('end-call-icon') as HTMLElement;
const statusIndicator = document.getElementById('status-indicator') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;

// -- State Variables --
let isCalling = false;
let chat: Chat | null = null;
let currentAudio: HTMLAudioElement | null = null; // For high-quality TTS playback
let recognizedTextForTurn = ''; // Holds the recognized speech for the current turn

// -- Web Speech API --
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognition: any | null = null;
let isAssistantSpeaking = false;


// -- Configuration --
const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY,
});

// -- Data for the Assistant --
const PRODUCTS_JSON = JSON.stringify([
  {"id": "p1", "name": "گوشی هوشمند مدل اکسین", "price": "۱۵٬۰۰۰٬۰۰۰ تومان", "features": ["دوربین ۵۰ مگاپیکسل", "صفحه نمایش ۶.۵ اینچ", "باتری ۵۰۰۰ میلی‌آمپر"]},
  {"id": "p2", "name": "لپتاپ پرولاین", "price": "۴۵٬۰۰۰٬۰۰۰ تومان", "features": ["پردازنده Core i7", "۱۶ گیگابایت رم", "حافظه SSD ۱ ترابایت"]},
  {"id": "p3", "name": "ساعت هوشمند فیت‌بند", "price": "۴٬۵۰۰٬۰۰۰ تومان", "features": ["ردیابی ضربان قلب", "GPS داخلی", "ضد آب تا ۵۰ متر"]}
]);

const FAQ_DOC = `
سوال: ساعات کاری شرکت چه زمانی است؟
پاسخ: ساعات کاری ما از شنبه تا چهارشنبه، از ساعت ۹ صبح تا ۵ بعد از ظهر است. روزهای پنجشنبه و جمعه تعطیل هستیم.

سوال: آیا ارسال به شهرستان دارید؟
پاسخ: بله، ما به تمام نقاط ایران محصولات را ارسال می‌کنیم. هزینه ارسال بر اساس مسافت و وزن کالا محاسبه می‌شود.

سوال: چگونه می‌توانم سفارشم را پیگیری کنم؟
پاسخ: پس از ثبت سفارش، یک کد رهگیری برای شما پیامک می‌شود. می‌توانید با استفاده از آن کد در وب‌سایت ما یا وب‌سایت شرکت پست، وضعیت سفارش خود را مشاهده کنید.

سوال: آیا امکان بازگشت کالا وجود دارد؟
پاسخ: بله، شما تا ۷ روز پس از دریافت کالا، در صورت عدم استفاده و باز نشدن بسته‌بندی، می‌توانید کالا را مرجوع کنید.
`;

const SYSTEM_INSTRUCTION = `شما یک دستیار صوتی هوشمند و خوش‌برخورد به نام "آوا" هستید که به عنوان منشی تلفنی یک شرکت کار می‌کنید. وظیفه شما پاسخگویی به مشتریان به زبان فارسی است. شما باید مکالمه را به صورت کاملاً طبیعی و محاوره‌ای پیش ببرید.

از اطلاعات زیر برای پاسخ به سوالات مشتریان استفاده کنید:
۱. اطلاعات محصولات (در قالب JSON):
${PRODUCTS_JSON}

۲. سوالات متداول (FAQ):
${FAQ_DOC}

دستورالعمل‌های کلیدی:
- همیشه به زبان فارسی روان و محاوره‌ای صحبت کنید.
- خودتان را در ابتدای مکالمه معرفی کنید. مثلا بگویید: "سلام، آوا هستم، چطور میتونم کمکتون کنم؟"
- اگر سوالی در مورد محصولات پرسیده شد، از اطلاعات JSON استفاده کنید.
- اگر سوالی شبیه به سوالات متداول بود، از داکیومنت FAQ پاسخ دهید.
- برای هر سوال دیگری، سعی کنید بهترین پاسخ ممکن را بدهید یا بگویید که اطلاعات کافی ندارید و کاربر را به بخش پشتیبانی ارجاع می‌دهید.
- مکالمه را کوتاه و مفید نگه دارید.`;

// -- Event Listeners --
callButton.addEventListener('click', toggleCall);

// -- Core Functions --
async function toggleCall() {
  isCalling = !isCalling;
  callButton.disabled = true;

  if (isCalling) {
    await startCall();
  } else {
    endCall();
  }

  updateUIVisibility(isCalling);
  callButton.disabled = false;
}

async function startCall() {
  updateStatus("در حال اتصال...");
  
  chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  if (SpeechRecognition) {
    setupSpeechRecognition();
    // Greet the user with high-quality TTS
    await speakText("سلام، آوا هستم. چطور میتونم کمکتون کنم?", () => {
        if (isCalling) startListening();
    });
  } else {
    updateStatus("مرورگر شما پشتیبانی نمی‌کند", true);
  }
}

function endCall() {
  isCalling = false;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  // Stop high-quality TTS audio if it's playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  chat = null;
  updateStatus("تماس پایان یافت");
}

function setupSpeechRecognition() {
  recognition = new SpeechRecognition();
  recognition.lang = 'fa-IR';
  recognition.continuous = false; // Process after user stops speaking
  recognition.interimResults = false; // We only care about the final result

  recognition.onresult = (event: any) => {
    recognizedTextForTurn = event.results[0][0].transcript.trim();
  };

  recognition.onend = () => {
    // Only process if we are still in a call and the assistant isn't talking
    if (isCalling && !isAssistantSpeaking) {
      const userText = recognizedTextForTurn;
      recognizedTextForTurn = ''; // Reset for the next turn

      if (userText) {
        sendUserMessageToGemini(userText);
      } else {
        // If no speech was detected, start listening again
        startListening();
      }
    }
  };

  recognition.onerror = (event: any) => {
    console.error("Speech recognition error:", event.error);
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
        updateStatus("خطای تشخیص گفتار", true);
    }
    // Let onend() handle re-listening logic to avoid race conditions.
  };
}

function startListening() {
  if (!isCalling || isAssistantSpeaking || !recognition) return;
  try {
      updateStatus("گوش می‌دهم...", false, 'listening');
      recognition.start();
  } catch (error) {
      console.error("Failed to start recognition:", error);
      // If it fails (e.g., already started), let the flow reset.
      // The onend handler will eventually trigger and restart the loop.
  }
}

async function sendUserMessageToGemini(userText: string) {
  if (!chat) return;
  
  updateStatus("در حال پردازش...", false, 'speaking'); // Visually show thinking
  
  try {
    const stream = await chat.sendMessageStream({ message: userText });
    
    let fullResponse = '';
    
    for await (const chunk of stream) {
      fullResponse += chunk.text;
    }
    
    updateStatus("در حال تولید صدا...", false, 'speaking');
    await speakText(fullResponse, () => {
        if(isCalling) startListening();
    });

  } catch (error) {
    console.error("Gemini API error:", error);
    updateStatus("خطا در ارتباط با سرور", true);
    await speakText("متاسفانه مشکلی پیش آمده. لطفا دوباره تلاش کنید.", () => {
        if(isCalling) startListening();
    });
  }
}

async function speakText(text: string, onEndCallback?: () => void) {
    if (!text || !isCalling) {
        onEndCallback?.();
        return;
    }
    isAssistantSpeaking = true;
    updateStatus("در حال صحبت...", false, 'speaking');

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    try {
        const stream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        // Using 'Charon' as a good, clear Farsi voice.
                        prebuiltVoiceConfig: { voiceName: 'Charon' },
                    },
                },
            },
        });

        let audioData = '';
        let mimeType = '';
        
        for await (const chunk of stream) {
            if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
                const inlineData = chunk.candidates[0].content.parts[0].inlineData;
                if (inlineData.data) {
                    audioData += inlineData.data;
                }
                if (inlineData.mimeType && !mimeType) {
                    mimeType = inlineData.mimeType;
                }
            }
        }

        if (audioData && mimeType) {
            const wavBlob = createWavBlob(audioData, mimeType);
            const audioUrl = URL.createObjectURL(wavBlob);
            currentAudio = new Audio(audioUrl);
            
            currentAudio.play().catch(error => {
                console.error("Audio playback failed:", error);
                isAssistantSpeaking = false;
                onEndCallback?.();
            });

            currentAudio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                currentAudio = null;
                isAssistantSpeaking = false;
                if (isCalling) {
                    onEndCallback ? onEndCallback() : startListening();
                }
            };

            currentAudio.onerror = (e) => {
                URL.revokeObjectURL(audioUrl);
                console.error("Audio playback error:", e);
                currentAudio = null;
                isAssistantSpeaking = false;
                onEndCallback?.();
            };

        } else {
            console.error("No audio content received from TTS API");
            isAssistantSpeaking = false;
            onEndCallback?.();
        }
    } catch (error) {
        console.error("Speech generation error:", error);
        isAssistantSpeaking = false;
        updateStatus("خطا در تولید صدا", true);
        onEndCallback?.();
    }
}


// -- WAV Audio Generation Helper Functions --

interface WavConversionOptions {
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
}

/**
 * Parses the MIME type string to extract audio parameters.
 * E.g., "audio/L16;rate=24000" -> { bitsPerSample: 16, rate: 24000 }
 */
function parseMimeType(mimeType: string): WavConversionOptions {
    const defaultOptions = {
        numChannels: 1,
        sampleRate: 24000,
        bitsPerSample: 16,
    };

    const parts = mimeType.split(';').map(s => s.trim());
    const [fileType] = parts;

    if (fileType.startsWith('audio/L')) {
        try {
            defaultOptions.bitsPerSample = parseInt(fileType.split('L')[1], 10);
        } catch (e) {
            console.warn(`Could not parse bits per sample from ${fileType}`);
        }
    }

    for (const param of parts.slice(1)) {
        const [key, value] = param.split('=').map(s => s.trim());
        if (key === 'rate') {
            try {
                defaultOptions.sampleRate = parseInt(value, 10);
            } catch (e) {
                console.warn(`Could not parse rate from ${param}`);
            }
        }
    }

    return defaultOptions;
}

/**
 * Creates a WAV file header.
 * @param dataLength The length of the raw audio data.
 * @param options Audio parameters.
 * @returns An ArrayBuffer containing the WAV header.
 */
function createWavHeader(dataLength: number, options: WavConversionOptions): ArrayBuffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    function writeString(view: DataView, offset: number, str: string) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true); // true for little-endian
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    return buffer;
}

/**
 * Converts a base64 string to a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Creates a WAV blob from raw audio data encoded in base64.
 * @param base64Data The base64 encoded audio data.
 * @param mimeType The MIME type of the raw audio.
 * @returns A Blob representing the WAV file.
 */
function createWavBlob(base64Data: string, mimeType: string): Blob {
    const audioData = base64ToUint8Array(base64Data);
    const options = parseMimeType(mimeType);
    const header = createWavHeader(audioData.length, options);
    return new Blob([header, audioData], { type: 'audio/wav' });
}


// -- UI Update Functions --
function updateStatus(text: string, isError = false, indicatorState: 'idle' | 'listening' | 'speaking' = 'idle') {
  statusText.textContent = text;
  statusText.style.color = isError ? 'var(--end-call-button-bg)' : 'var(--on-surface-secondary-color)';
  
  statusIndicator.className = ''; // Reset classes
  statusIndicator.classList.add('status-indicator'); // Base class
  if(isCalling) {
    statusIndicator.classList.add(`status-${indicatorState}`);
  } else {
    statusIndicator.classList.add(`status-idle`);
  }
}

function updateUIVisibility(isCallActive: boolean) {
  callButton.classList.toggle('active', isCallActive);
  callIcon.style.display = isCallActive ? 'none' : 'block';
  endCallIcon.style.display = isCallActive ? 'block' : 'none';
  callButton.setAttribute('aria-label', isCallActive ? 'پایان تماس' : 'شروع تماس');
}