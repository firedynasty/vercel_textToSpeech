import React, { useState, useEffect, useRef } from 'react';

const TextToSpeechComponent = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [speechRate, setSpeechRate] = useState(1);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [lastUsedVoice, setLastUsedVoice] = useState('None selected yet');
  // State for textarea and sentences
  const [textareaContent, setTextareaContent] = useState('');
  const [sentences, setSentences] = useState([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const autoAdvanceRef = useRef(true);
  autoAdvanceRef.current = autoAdvance;
  const sentencesRef = useRef([]);
  sentencesRef.current = sentences;
  const speakSentenceRef = useRef(null);
  const textareaRef = useRef(null);
  const currentSentenceIndexRef = useRef(-1);
  currentSentenceIndexRef.current = currentSentenceIndex;
  const [darkMode, setDarkMode] = useState(false);
  const [fontSize, setFontSize] = useState(1.1);
  const darkModeToggleCooldownRef = useRef(false);
  const [interactionMode, setInteractionMode] = useState('cursive'); // 'tts' or 'cursive'
  const [cursiveSpeed, setCursiveSpeed] = useState(() => parseInt(localStorage.getItem('tts-cursive-speed') ?? '3'));
  const [cursiveSize, setCursiveSize] = useState(() => parseInt(localStorage.getItem('tts-cursive-size') ?? '52'));
  const cursiveOutputRef = useRef(null);
  const cursiveTimerRef = useRef(null);
  const [ttsEngine, setTtsEngine] = useState(() => localStorage.getItem('appTtsEngine') || 'browser');
  const [openaiVoice, setOpenaiVoice] = useState(() => localStorage.getItem('appOpenaiVoice') || 'onyx');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(() => {
    const key = localStorage.getItem('OPENAI_API_KEY') || '';
    return key ? '••••' + key.slice(-4) : '';
  });
  const ttsEngineRef = useRef('browser');
  ttsEngineRef.current = ttsEngine;
  const openaiVoiceRef = useRef('onyx');
  openaiVoiceRef.current = openaiVoice;
  const currentAudioRef = useRef(null);

  // Load cursive font
  useEffect(() => {
    if (!document.getElementById('cursive-font-link')) {
      const link = document.createElement('link');
      link.id = 'cursive-font-link';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  // Animate text in cursive style
  const animateCursive = (text) => {
    if (!cursiveOutputRef.current || !text) return;
    // Stop any existing animation
    if (cursiveTimerRef.current) { clearTimeout(cursiveTimerRef.current); cursiveTimerRef.current = null; }

    const outputEl = cursiveOutputRef.current;
    outputEl.innerHTML = '';
    outputEl.scrollTop = 0;

    const fadeMs = [700, 500, 350, 220, 120][cursiveSpeed - 1];
    const delayMs = [600, 420, 280, 170, 90][cursiveSpeed - 1];

    const words = text.split(/\s+/).filter(Boolean);
    const spans = words.map((word, i) => {
      const sp = document.createElement('span');
      sp.style.cssText = `display:inline;opacity:0;transition:opacity ${fadeMs}ms ease`;
      sp.textContent = i < words.length - 1 ? word + ' ' : word;
      outputEl.appendChild(sp);
      return sp;
    });

    let i = 0;
    function next() {
      if (i >= spans.length) { cursiveTimerRef.current = null; return; }
      spans[i].style.opacity = '1';
      const nearBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 80;
      if (nearBottom) outputEl.scrollTop = outputEl.scrollHeight;
      i++;
      cursiveTimerRef.current = setTimeout(next, delayMs);
    }
    next();
  };

  // Check if running on localhost
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Auto-load on mount
  useEffect(() => {
    loadFromBlob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load available voices when component mounts
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
      console.log("Available voices:", voices.map(v => `${v.name} (${v.lang})`).join(', '));
    };

    // Load voices immediately if available
    loadVoices();

    // Also listen for voiceschanged event
    speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Keyboard shortcuts: Escape pastes from clipboard, ArrowRight advances sentence
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handlePasteFromClipboard();
      }
      if (e.key === 'ArrowRight') {
        const nextIndex = currentSentenceIndexRef.current + 1;
        if (nextIndex < sentencesRef.current.length) {
          setCurrentSentenceIndex(nextIndex);
          animateCursive(sentencesRef.current[nextIndex]);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load content from cloud or localStorage
  const loadFromBlob = async () => {
    setIsLoading(true);
    try {
      if (isLocalhost) {
        const stored = localStorage.getItem('tts-content');
        if (stored) {
          setTextareaContent(stored);
          processTextIntoSentences(stored);
        }
      } else {
        const response = await fetch('/api/files');
        if (response.ok) {
          const data = await response.json();
          const content = (data.files || {})['content.txt'];
          if (content) {
            setTextareaContent(content);
            processTextIntoSentences(content);
          }
        }
      }
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save content to cloud or localStorage
  const saveToBlob = async () => {
    setIsSaving(true);
    try {
      if (isLocalhost) {
        localStorage.setItem('tts-content', textareaContent);
        alert('Saved locally!');
      } else {
        const response = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'content.txt',
            content: textareaContent,
            accessCode: '123',
          }),
        });

        if (response.ok) {
          alert('Saved to cloud!');
        } else {
          const data = await response.json();
          alert('Error saving: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving');
    } finally {
      setIsSaving(false);
    }
  };

  // Strip markdown formatting from pasted text
  const stripMarkdown = (text) => {
    return text
      .replace(/^#{1,6}\s+/gm, '')        // headers: ## Heading
      .replace(/^>\s?/gm, '')              // blockquotes: > text
      .replace(/^---+$/gm, '')             // horizontal rules: ---
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1') // bold+italic: ***text***
      .replace(/\*\*(.+?)\*\*/g, '$1')    // bold: **text**
      .replace(/\*(.+?)\*/g, '$1')        // italic: *text*
      .replace(/^[-*+]\s+/gm, '')         // unordered list items: - item
      .replace(/^\d+\.\s+/gm, '')         // ordered list items: 1. item
      .replace(/`{3}[\s\S]*?`{3}/g, '')   // code blocks: ```...```
      .replace(/`(.+?)`/g, '$1')          // inline code: `code`
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links: [text](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images: ![alt](url)
      .replace(/\n{3,}/g, '\n\n');         // collapse excessive newlines
  };

  // Process textarea text into sentences
  const processTextIntoSentences = (text) => {
    if (!text || !text.trim()) {
      setSentences([]);
      return;
    }

    // Split by sentence endings (., !, ?) and newlines
    const allRawSentences = text.split(/[.!?\n]+/).filter(sentence => sentence.trim().length > 0);

    // Consolidate short sentences (< 15 characters)
    const consolidatedSentences = [];
    for (let i = 0; i < allRawSentences.length; i++) {
      const currentSentence = allRawSentences[i].trim();
      if (!currentSentence) continue;

      const charLength = currentSentence.length;

      // If sentence is very short, merge with previous or next
      if (charLength < 15 && consolidatedSentences.length > 0) {
        const lastIndex = consolidatedSentences.length - 1;
        consolidatedSentences[lastIndex] = consolidatedSentences[lastIndex] + '. ' + currentSentence;
      } else if (charLength < 15 && i < allRawSentences.length - 1) {
        const nextSentence = allRawSentences[i + 1].trim();
        if (nextSentence) {
          consolidatedSentences.push(currentSentence + '. ' + nextSentence);
          i++;
        } else {
          consolidatedSentences.push(currentSentence);
        }
      } else {
        consolidatedSentences.push(currentSentence);
      }
    }

    setSentences(consolidatedSentences);
    setCurrentSentenceIndex(-1);
  };

  // Paste from clipboard
  const handlePasteFromClipboard = async ({ startReading = false } = {}) => {
    try {
      const raw = await navigator.clipboard.readText();
      const text = stripMarkdown(raw);
      setTextareaContent(text);
      processTextIntoSentences(text);
      // Scroll back up to the textarea
      if (textareaRef.current) {
        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Start reading from the first sentence if requested
      if (startReading && text && text.trim()) {
        const newSentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (newSentences.length > 0) {
          setTimeout(() => {
            speakSentenceRef.current(sentencesRef.current[0], 0);
          }, 100);
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      alert('Failed to read from clipboard. Please paste manually or check permissions.');
    }
  };

  // Append clipboard to existing textarea content
  const handleAppendFromClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const text = stripMarkdown(raw);
      const combined = textareaContent + (textareaContent ? '\n' : '') + text;
      setTextareaContent(combined);
      processTextIntoSentences(combined);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      alert('Failed to read from clipboard. Please paste manually or check permissions.');
    }
  };

  // Handle textarea change
  const handleTextareaChange = (e) => {
    const text = e.target.value;
    setTextareaContent(text);
    processTextIntoSentences(text);
  };

  // Handle paste in textarea - auto-start reading, strip markdown
  const handleTextareaPaste = (e) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && pastedText.trim()) {
      e.preventDefault();
      const cleaned = stripMarkdown(pastedText);
      const newText = textareaContent
        ? textareaContent.substring(0, e.target.selectionStart) + cleaned + textareaContent.substring(e.target.selectionEnd)
        : cleaned;
      setTextareaContent(newText);
      processTextIntoSentences(newText);
    }
  };

  // Toggle dark mode with 1000ms cooldown
  const handleDarkModeToggle = () => {
    if (darkModeToggleCooldownRef.current) return;
    darkModeToggleCooldownRef.current = true;
    setDarkMode(prev => !prev);
    setTimeout(() => { darkModeToggleCooldownRef.current = false; }, 1000);
  };

  // Theme colors
  const theme = darkMode ? {
    bg: '#1a1a2e', text: '#e0e0e0', textSecondary: '#999',
    border: '#333', inputBg: '#16213e', inputBorder: '#444',
    cardBg: '#16213e', cardBorder: '#333',
    sectionBg: '#0f3460', sectionBorder: '#1a5276',
    highlight: '#e6a817', sidebarBg: '#2a2a4a', sidebarBorder: '#444',
    navbarBg: '#2a2a4a', heading: '#7ec8e3',
    btnPaste: '#059669', btnAppend: '#d97706',
  } : {
    bg: '#ffffff', text: '#000000', textSecondary: '#666',
    border: '#ccc', inputBg: '#ffffff', inputBorder: '#ccc',
    cardBg: '#f8f9fa', cardBorder: '#dee2e6',
    sectionBg: '#f0f9ff', sectionBorder: '#3B82F6',
    highlight: '#ffd43b', sidebarBg: '#e0e0e0', sidebarBorder: '#ccc',
    navbarBg: autoAdvance ? '#e6ffe6' : '#f0f0f0', heading: '#1e40af',
    btnPaste: '#10B981', btnAppend: '#F59E0B',
  };

  // Speak text using OpenAI TTS API
  const speakWithOpenAI = (text, { onEnd, onError } = {}) => {
    const apiKey = localStorage.getItem('OPENAI_API_KEY') || '';
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not found in localStorage');
      if (onError) onError(new Error('No API key'));
      return;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    (async () => {
      try {
        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({ model: 'tts-1', input: text, voice: openaiVoiceRef.current, speed: 1.0 })
        });
        if (!resp.ok) {
          console.error('OpenAI TTS error:', resp.status, await resp.text());
          if (onError) onError(new Error('OpenAI error ' + resp.status));
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          if (onEnd) onEnd();
        };
        audio.onerror = (e) => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          if (onError) onError(e);
        };
        audio.play();
      } catch (err) {
        console.error('OpenAI TTS fetch error:', err);
        if (onError) onError(err);
      }
    })();
  };

  // Speak a sentence
  const speakSentence = (sentenceText, index) => {
    if (!sentenceText) return;

    console.log(`[speakSentence] called with index=${index}, text="${sentenceText.substring(0, 50)}..."`);

    // Cancel any current/queued speech immediately
    speechSynthesis.cancel();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    setCurrentSentenceIndex(index);
    console.log(`[speakSentence] setCurrentSentenceIndex(${index})`);

    // === OpenAI TTS ===
    if (ttsEngineRef.current === 'openai') {
      speakWithOpenAI(sentenceText, {
        onEnd: () => {
          console.log(`[onend openai] finished index=${index}, autoAdvance=${autoAdvanceRef.current}`);
          if (autoAdvanceRef.current) {
            const nextIndex = index + 1;
            if (nextIndex < sentencesRef.current.length) {
              setTimeout(() => {
                speakSentenceRef.current(sentencesRef.current[nextIndex], nextIndex);
              }, 300);
            }
          }
        },
        onError: (e) => console.error('OpenAI TTS error:', e)
      });
      return;
    }

    // === Browser TTS ===
    const utterance = new SpeechSynthesisUtterance(sentenceText);
    utterance.lang = selectedLanguage;
    utterance.rate = speechRate;

    const voices = availableVoices;

    // Use the same voice selection logic as speakText
    if (selectedLanguage.includes('en-')) {
      let englishVoice = voices.find(voice =>
        (voice.lang.includes('en-') && voice.name.includes('Enhanced')) ||
        (voice.lang.includes('en-') && voice.name.includes('Premium'))
      );

      if (!englishVoice) {
        englishVoice = voices.find(voice =>
          voice.lang.includes('en-') && voice.name.includes('Google')
        );
      }

      if (!englishVoice) {
        const qualityVoiceNames = ['Daniel', 'Samantha', 'Alex', 'Karen', 'Microsoft David'];
        for (const name of qualityVoiceNames) {
          const foundVoice = voices.find(voice =>
            voice.lang.includes('en-') && voice.name.includes(name)
          );
          if (foundVoice) {
            englishVoice = foundVoice;
            break;
          }
        }
      }

      if (!englishVoice) {
        englishVoice = voices.find(voice => voice.lang.includes('en-'));
      }

      if (englishVoice) {
        setLastUsedVoice(`${englishVoice.name} (${englishVoice.lang})`);
        utterance.voice = englishVoice;
      }
    } else if ((selectedLanguage === 'zh-CN' || selectedLanguage === 'zh-HK')) {
      if (selectedLanguage === 'zh-CN') {
        let chineseVoice;
        const blacklistedVoices = ['Eddy', 'Flo', 'Grandma', 'Grandpa'];

        chineseVoice = voices.find(voice =>
          voice.name.includes('Google') && voice.lang.includes('zh-CN') &&
          !blacklistedVoices.some(bad => voice.name.includes(bad)));

        if (!chineseVoice) {
          chineseVoice = voices.find(voice =>
            voice.lang.includes('zh-CN') &&
            (voice.name.includes('Enhanced') || voice.name.includes('Premium')) &&
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }

        if (!chineseVoice) {
          const goodMandarinNames = ['Li-Mu', 'Ting-Ting', 'Sin-ji', 'Mei-Jia', 'Yaoyao', 'Kangkang', 'Huihui'];
          for (const name of goodMandarinNames) {
            const foundVoice = voices.find(voice =>
              voice.lang.includes('zh-CN') && voice.name.includes(name));
            if (foundVoice) {
              chineseVoice = foundVoice;
              break;
            }
          }
        }

        if (!chineseVoice) {
          chineseVoice = voices.find(voice =>
            voice.lang.includes('zh-CN') &&
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }

        if (!chineseVoice) {
          chineseVoice = voices.find(voice => voice.lang.includes('zh-CN'));
        }

        if (chineseVoice) {
          setLastUsedVoice(`${chineseVoice.name} (${chineseVoice.lang})`);
          utterance.voice = chineseVoice;
        }
      } else if (selectedLanguage === 'zh-HK') {
        let cantoneseVoice;

        cantoneseVoice = voices.find(voice =>
          voice.name.includes('Google') && voice.lang.includes('zh-HK'));

        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice =>
            voice.lang.includes('zh-HK') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
        }

        if (!cantoneseVoice) {
          const goodCantoneseNames = ['Sin-ji', 'Hong Kong'];
          for (const name of goodCantoneseNames) {
            const foundVoice = voices.find(voice =>
              voice.lang.includes('zh-HK') && voice.name.includes(name));
            if (foundVoice) {
              cantoneseVoice = foundVoice;
              break;
            }
          }
        }

        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice => voice.lang.includes('zh-HK'));
        }

        if (cantoneseVoice) {
          setLastUsedVoice(`${cantoneseVoice.name} (${cantoneseVoice.lang})`);
          utterance.voice = cantoneseVoice;
        }
      }
    } else if (selectedLanguage === 'ko-KR') {
      const koreanVoice = voices.find(voice => voice.name === 'Google 한국의');
      if (koreanVoice) {
        setLastUsedVoice(`${koreanVoice.name} (${koreanVoice.lang})`);
        utterance.voice = koreanVoice;
      }
    } else if (selectedLanguage === 'fr-FR') {
      let frenchVoice;

      frenchVoice = voices.find(voice =>
        voice.name.includes('Google') && voice.lang.includes('fr'));

      if (!frenchVoice) {
        frenchVoice = voices.find(voice =>
          voice.lang.includes('fr') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
      }

      if (!frenchVoice) {
        const goodFrenchNames = ['Amelie', 'Thomas', 'Virginie', 'Audrey', 'Marie', 'Paul'];
        for (const name of goodFrenchNames) {
          const foundVoice = voices.find(voice =>
            voice.lang.includes('fr') && voice.name.includes(name));
          if (foundVoice) {
            frenchVoice = foundVoice;
            break;
          }
        }
      }

      if (!frenchVoice) {
        frenchVoice = voices.find(voice => voice.lang.includes('fr'));
      }

      if (frenchVoice) {
        setLastUsedVoice(`${frenchVoice.name} (${frenchVoice.lang})`);
        utterance.voice = frenchVoice;
      }
    } else if (selectedLanguage === 'es-ES') {
      const spanishVoice = voices.find(voice =>
        voice.lang.includes('es-') && (voice.name.includes('Google') || voice.name.includes('Enhanced'))
      );
      if (spanishVoice) {
        setLastUsedVoice(`${spanishVoice.name} (${spanishVoice.lang})`);
        utterance.voice = spanishVoice;
      }
    } else if (selectedLanguage === 'he-IL') {
      let hebrewVoice;

      hebrewVoice = voices.find(voice =>
        voice.name.includes('Google') && voice.lang.includes('he'));

      if (!hebrewVoice) {
        hebrewVoice = voices.find(voice =>
          voice.lang.includes('he') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
      }

      if (!hebrewVoice) {
        const goodHebrewNames = ['Asaf', 'Carmit', 'Microsoft Asaf', 'Microsoft Carmit', 'Zohar', 'Lior', 'Hebrew', 'Apple Hebrew', 'Siri Hebrew'];
        for (const name of goodHebrewNames) {
          const foundVoice = voices.find(voice =>
            voice.lang.includes('he') && voice.name.includes(name));
          if (foundVoice) {
            hebrewVoice = foundVoice;
            break;
          }
        }
      }

      if (!hebrewVoice) {
        hebrewVoice = voices.find(voice => voice.lang.includes('he'));
      }

      if (hebrewVoice) {
        setLastUsedVoice(`${hebrewVoice.name} (${hebrewVoice.lang})`);
        utterance.voice = hebrewVoice;
      }
    }

    utterance.onend = () => {
      console.log(`[onend] finished index=${index}, autoAdvance=${autoAdvanceRef.current}`);
      if (autoAdvanceRef.current) {
        const nextIndex = index + 1;
        console.log(`[onend] advancing to nextIndex=${nextIndex}, total=${sentencesRef.current.length}`);
        if (nextIndex < sentencesRef.current.length) {
          setTimeout(() => {
            speakSentenceRef.current(sentencesRef.current[nextIndex], nextIndex);
          }, 300);
        }
      }
    };

    speechSynthesis.speak(utterance);
  };
  speakSentenceRef.current = speakSentence;

  console.log(`[render] currentSentenceIndex=${currentSentenceIndex}, sentences.length=${sentences.length}`);

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: 0, display: 'flex', height: '100vh', backgroundColor: theme.bg, color: theme.text }}>
      {/* Main content */}
      <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
        <h1>React TTS Component - Multi-Language Test</h1>

        {/* Text Input Section */}
      <div style={{ marginBottom: '2rem', padding: '1rem', border: `2px solid ${theme.sectionBorder}`, borderRadius: '0.5rem', backgroundColor: theme.sectionBg }}>
        <h2 style={{ marginTop: 0, color: theme.heading }}>Text-to-Speech Reader</h2>

        <div style={{ marginBottom: '1rem' }}>
          <textarea
            ref={textareaRef}
            placeholder="Paste your text here or click 'Paste from Clipboard' to automatically get clipboard content..."
            value={textareaContent}
            onChange={handleTextareaChange}
            onPaste={handleTextareaPaste}
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '0.75rem',
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: '0.25rem',
              fontFamily: 'inherit',
              fontSize: '1rem',
              resize: 'vertical',
              boxSizing: 'border-box',
              backgroundColor: theme.inputBg,
              color: theme.text
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={handlePasteFromClipboard}
            style={{
              padding: '0.5rem 1rem',
              color: 'white',
              backgroundColor: '#10B981',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Paste from Clipboard
          </button>

          <button
            onClick={handleAppendFromClipboard}
            style={{
              padding: '0.5rem 1rem',
              color: 'white',
              backgroundColor: '#F59E0B',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Append
          </button>

          <button
            onClick={loadFromBlob}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              background: 'rgba(76, 175, 80, 0.3)',
              border: 'none',
              borderRadius: '6px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1rem'
            }}
          >
            {isLoading ? 'Loading...' : 'Load'}
          </button>

          <button
            onClick={saveToBlob}
            disabled={isSaving}
            style={{
              padding: '8px 16px',
              background: 'rgba(76, 175, 80, 0.3)',
              border: 'none',
              borderRadius: '6px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1rem'
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>

          <button
            onClick={() => setFontSize(prev => Math.max(0.5, prev - 0.1))}
            style={{
              padding: '8px 14px',
              background: '#6366f1',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1.1rem'
            }}
          >
            -
          </button>

          <button
            onClick={() => setFontSize(prev => Math.min(3, prev + 0.1))}
            style={{
              padding: '8px 14px',
              background: '#6366f1',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1.1rem'
            }}
          >
            +
          </button>

          <a
            href="/youtubetranscriptreader.html"
            style={{
              padding: '8px 14px',
              background: '#6366f1',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1.1rem',
              textDecoration: 'none',
              display: 'inline-block'
            }}
            title="YouTube Transcript Reader"
          >
            📖▶
          </a>
        </div>

        {/* Sticky container for navbar + cursive output */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, marginTop: '0.75rem' }}>
        {/* Auto-advance toggle - navbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', backgroundColor: theme.navbarBg, borderRadius: interactionMode === 'cursive' ? '8px 8px 0 0' : '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <span
            onClick={() => { console.log('[navbar] Stop After Line clicked → autoAdvance=false'); setAutoAdvance(false); }}
            style={{ fontWeight: 'bold', fontSize: '12px', color: '#666', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', backgroundColor: !autoAdvance ? '#ffcdd2' : 'transparent' }}
          >Stop After Line</span>
          <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: autoAdvance ? '#4CAF50' : '#ddd',
              transition: '.4s', borderRadius: '24px'
            }}>
              <span style={{
                position: 'absolute', content: '""',
                height: '18px', width: '18px',
                left: autoAdvance ? '29px' : '3px',
                bottom: '3px',
                backgroundColor: 'white',
                transition: '.4s', borderRadius: '50%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </span>
          </label>
          <span
            onClick={() => setAutoAdvance(true)}
            style={{ fontWeight: 'bold', fontSize: '12px', color: autoAdvance ? '#4CAF50' : '#666', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', backgroundColor: autoAdvance ? '#c8e6c9' : 'transparent' }}
          >Auto Next Line</span>

          {/* TTS / Cursive mode toggle */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px', borderLeft: '1px solid #ccc', paddingLeft: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', fontSize: '12px', fontWeight: interactionMode === 'tts' ? 'bold' : 'normal', color: interactionMode === 'tts' ? '#2563eb' : '#666' }}>
              <input type="radio" name="mode" value="tts" checked={interactionMode === 'tts'} onChange={() => setInteractionMode('tts')} style={{ margin: 0 }} />
              TTS
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', fontSize: '12px', fontWeight: interactionMode === 'cursive' ? 'bold' : 'normal', color: interactionMode === 'cursive' ? '#8b4513' : '#666' }}>
              <input type="radio" name="mode" value="cursive" checked={interactionMode === 'cursive'} onChange={() => setInteractionMode('cursive')} style={{ margin: 0 }} />
              Cursive
            </label>
            {interactionMode === 'cursive' && (
              <>
                <label style={{ fontSize: '10px', color: '#8b4513', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  Spd
                  <input type="range" min="1" max="5" value={cursiveSpeed}
                    onChange={(e) => { const v = parseInt(e.target.value); setCursiveSpeed(v); localStorage.setItem('tts-cursive-speed', v); }}
                    style={{ width: '50px', accentColor: '#8b4513' }} />
                </label>
                <label style={{ fontSize: '10px', color: '#8b4513', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  Size
                  <input type="range" min="28" max="80" value={cursiveSize}
                    onChange={(e) => { const v = parseInt(e.target.value); setCursiveSize(v); localStorage.setItem('tts-cursive-size', v); }}
                    style={{ width: '50px', accentColor: '#8b4513' }} />
                </label>
                <button
                  onClick={() => {
                    const nextIndex = currentSentenceIndex + 1;
                    if (nextIndex < sentences.length) {
                      setCurrentSentenceIndex(nextIndex);
                      animateCursive(sentences[nextIndex]);
                    }
                  }}
                  disabled={currentSentenceIndex >= sentences.length - 1}
                  title="Next sentence"
                  style={{ padding: '0 8px', border: '1px solid #c9b99a', borderRadius: 2, background: '#8b4513', color: '#f5f0e8', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
                >▼</button>
              </>
            )}
          </span>

          <button
            onClick={handlePasteFromClipboard}
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              color: 'white',
              backgroundColor: '#10B981',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
          >
            Paste from Clipboard
          </button>

          <span
            onClick={handleDarkModeToggle}
            style={{
              padding: '4px 12px',
              color: 'white',
              backgroundColor: darkMode ? '#f59e0b' : '#374151',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              userSelect: 'none'
            }}
          >
            {darkMode ? 'Light' : 'Dark'}
          </span>

          {/* TTS Engine Toggle */}
          <button
            onClick={() => {
              const next = ttsEngine === 'browser' ? 'openai' : 'browser';
              setTtsEngine(next);
              localStorage.setItem('appTtsEngine', next);
            }}
            style={{
              padding: '4px 12px',
              color: 'white',
              backgroundColor: ttsEngine === 'openai' ? '#16a34a' : '#6b7280',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
            title={ttsEngine === 'openai' ? 'Using OpenAI TTS (click for browser)' : 'Using browser TTS (click for OpenAI)'}
          >
            {ttsEngine === 'openai' ? 'AI' : 'TTS'}
          </button>

          {/* OpenAI voice + key */}
          {ttsEngine === 'openai' && (
            <>
              <select
                value={openaiVoice}
                onChange={(e) => { setOpenaiVoice(e.target.value); localStorage.setItem('appOpenaiVoice', e.target.value); }}
                style={{ padding: '2px 6px', fontSize: '12px', borderRadius: '4px', border: '1px solid #22c55e', backgroundColor: '#f0fdf4', color: '#166534' }}
                title="Select OpenAI voice"
              >
                <option value="onyx">Onyx</option>
                <option value="nova">Nova</option>
                <option value="alloy">Alloy</option>
                <option value="echo">Echo</option>
                <option value="fable">Fable</option>
                <option value="shimmer">Shimmer</option>
              </select>
              <button
                onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                style={{
                  padding: '4px 8px',
                  fontSize: '12px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: localStorage.getItem('OPENAI_API_KEY') ? '#dcfce7' : '#fee2e2',
                  color: localStorage.getItem('OPENAI_API_KEY') ? '#166534' : '#991b1b'
                }}
                title={localStorage.getItem('OPENAI_API_KEY') ? 'API key set — click to change' : 'No API key — click to enter'}
              >
                Key
              </button>
              {showApiKeyInput && (
                <input
                  type="text"
                  placeholder="sk-..."
                  value={apiKeyValue}
                  onFocus={() => { if (apiKeyValue.startsWith('••••')) setApiKeyValue(''); }}
                  onChange={(e) => setApiKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && apiKeyValue && !apiKeyValue.startsWith('••••')) {
                      localStorage.setItem('OPENAI_API_KEY', apiKeyValue);
                      setApiKeyValue('••••' + apiKeyValue.slice(-4));
                      setShowApiKeyInput(false);
                    }
                  }}
                  onBlur={() => {
                    if (apiKeyValue && !apiKeyValue.startsWith('••••')) {
                      localStorage.setItem('OPENAI_API_KEY', apiKeyValue);
                      setApiKeyValue('••••' + apiKeyValue.slice(-4));
                    }
                  }}
                  style={{ padding: '2px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #22c55e', width: '150px' }}
                  title="Paste OpenAI API key and press Enter"
                />
              )}
            </>
          )}
        </div>

        {/* Cursive output area - inside sticky container */}
        {interactionMode === 'cursive' && (
          <div style={{
            padding: '24px',
            background: '#f5f0e8',
            backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, #c9b99a 31px, #c9b99a 32px)',
            borderRadius: '0 0 8px 8px',
            border: '2px solid #c9b99a',
            borderTop: 'none',
            minHeight: '150px',
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            <div
              ref={cursiveOutputRef}
              style={{
                fontFamily: "'Alex Brush', cursive",
                fontSize: cursiveSize + 'px',
                lineHeight: 1.25,
                color: '#1a1209',
                wordBreak: 'break-word'
              }}
            />
          </div>
        )}
        </div>{/* end sticky container */}

        {/* Reading Area - Clickable Sentence Divs */}
        {sentences.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ color: theme.heading }}>Click any sentence to {interactionMode === 'cursive' ? 'write it in cursive' : 'read it aloud'}:</h3>
            <div style={{
              backgroundColor: theme.cardBg,
              border: `2px solid ${theme.cardBorder}`,
              borderRadius: '0.5rem',
              padding: '1.5rem',
              minHeight: '200px',
              fontSize: `${fontSize}rem`,
              lineHeight: '1.8'
            }}>
              {sentences.map((sentence, index) => (
                <div
                  key={index}
                  onClick={() => {
                    setCurrentSentenceIndex(index);
                    if (interactionMode === 'cursive') {
                      animateCursive(sentence);
                    } else {
                      speakSentence(sentence, index);
                    }
                  }}
                  style={{
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    cursor: 'pointer',
                    borderRadius: '0.25rem',
                    backgroundColor: currentSentenceIndex === index ? theme.highlight : 'transparent',
                    transition: 'background-color 0.2s',
                    fontWeight: currentSentenceIndex === index ? 'bold' : 'normal',
                    boxShadow: currentSentenceIndex === index ? `0 0 5px ${theme.highlight}80` : 'none',
                    color: currentSentenceIndex === index ? '#000' : theme.text
                  }}
                >
                  {sentence}.
                </div>
              ))}
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: theme.textSecondary }}>
              {sentences.length} sentences detected
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>

        <select 
          id="languageSelect" 
          value={selectedLanguage} 
          onChange={(e) => setSelectedLanguage(e.target.value)}
          style={{ padding: '0.5rem', border: `1px solid ${theme.inputBorder}`, borderRadius: '0.25rem', backgroundColor: theme.inputBg, color: theme.text }}
        >
          <option value="zh-HK">Cantonese</option>
          <option value="en-US">English</option>
          <option value="fr-FR">French</option>
          <option value="es-ES">Spanish</option>
          <option value="zh-CN">Mandarin</option>
          <option value="ko-KR">Korean</option>
          <option value="he-IL">Hebrew</option>
        </select>

        <select 
          id="rateSelect" 
          value={speechRate} 
          onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
          style={{ padding: '0.5rem', border: `1px solid ${theme.inputBorder}`, borderRadius: '0.25rem', backgroundColor: theme.inputBg, color: theme.text }}
        >
          <option value="1">1x</option>
          <option value="1.5">1.5x</option>
          <option value="0.7">0.7x</option>
        </select>
      </div>

        {/* Debug Info */}
        <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: theme.textSecondary }}>
          <p>Available voices: {availableVoices.length}</p>
          <p>Current language: {selectedLanguage}</p>
          <p>Speech rate: {speechRate}x</p>
          <p><strong>Last Used Voice:</strong> <span style={{color: '#2563eb', fontWeight: 'bold'}}>{lastUsedVoice}</span></p>
        </div>
      </div>
    </div>
  );
};

export default TextToSpeechComponent;