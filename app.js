/**
 * app.js - Torah Insights SPA Controller
 * Manages state, routing, UI rendering, local storage, gematria computations, and file uploads.
 */

// --- Global Application State ---
const State = {
    insights: [],        // All loaded insights (default + user created + uploaded)
    bookmarks: [],       // Saved insight IDs
    comments: {},        // Comments keyed by insight ID
    upvotes: {},         // Upvotes keyed by insight ID
    userInsights: [],    // Insights written by user
    uploadedInsights: [],// Insights uploaded via text files
    userStreak: 3,       // Persistent study streak
    activeView: 'verse-analysis-unified-view',
    selectedInsightId: null,
    activePardesTab: 'peshat',
    activeLibraryTab: 'bookmarks',
    fontSize: 18,        // Default reader font size in pixels
    theme: 'light',
    bgTheme: 'parchment', // Separate bg selection
    textTheme: 'espresso', // Separate text selection
    sharedVerse: '',      // Shared text input across calculator pages
    searchHistory: {      // Local history list
        gematria: [],
        wordRep: [],
        rashei: [],
        unified: [],
        anagram: []
    },
    tanakhVerses: [],    // Indexed offline verses of the entire Tanakh
    userRole: 'user',    // 'user' or 'admin'
    pendingRequests: [], // Admin approval queue
    deletedDefaultIds: [], // IDs of deleted default insights
    editedDefaultInsights: {}, // Merged edits of default insights keyed by ID
    editedVerses: {}     // Admin-edited Tanakh verses keyed by "bookHeb|chapter|verse"
};

// --- Gematria Engine ---
const GematriaValues = {
    'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
    'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
    'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
    'ך': 20, 'ם': 40, 'ן': 50, 'ף': 80, 'ץ': 90
};

function calculateGematria(text) {
    let sum = 0;
    const cleanText = text.replace(/[^א-ת]/g, ''); // Keep only Hebrew letters
    for (let char of cleanText) {
        if (GematriaValues[char]) {
            sum += GematriaValues[char];
        }
    }
    return sum;
}

// Convert numbers to Hebrew letter numerals (simplified)
function numberToHebrew(num) {
    if (num <= 0) return "";
    let result = "";
    const units = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
    const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    const hundreds = ["", "ק", "ר", "ש", "ת"];
    
    let temp = num;
    
    // Hundreds
    if (temp >= 100) {
        let hIdx = Math.floor(temp / 100);
        if (hIdx > 4) {
            result += "ת".repeat(Math.floor(hIdx / 4));
            let rem = hIdx % 4;
            if (rem > 0) result += hundreds[rem];
        } else {
            result += hundreds[hIdx];
        }
        temp = temp % 100;
    }
    
    // Special case for 15 (טו) and 16 (טז) to avoid names of God
    if (temp === 15) {
        result += "טו";
    } else if (temp === 16) {
        result += "טז";
    } else {
        // Tens
        if (temp >= 10) {
            result += tens[Math.floor(temp / 10)];
            temp = temp % 10;
        }
        // Units
        if (temp >= 1) {
            result += units[temp];
        }
    }
    
    // Add double quote before the last letter for traditional look
    if (result.length > 1) {
        result = result.substring(0, result.length - 1) + '"' + result.charAt(result.length - 1);
    } else if (result.length === 1) {
        result = result + "'";
    }
    
    return result;
}

// --- Helper: Find Insight by Coordinate ---
function findInsightByCoordinate(bookHeb, chapterNum, verseNum) {
    return State.insights.find(insight => {
        // 1. Try parsing parasha (for user written or uploaded insights)
        if (insight.parasha) {
            const parsed = parseHebrewReference(insight.parasha);
            if (parsed && parsed.bookHeb === bookHeb && parsed.chapter === chapterNum && parsed.verse === verseNum) {
                return true;
            }
        }
        
        // 2. Try parsing verseText if it has book info
        if (insight.verseText) {
            const parsed = parseHebrewReference(insight.verseText);
            if (parsed && parsed.bookHeb === bookHeb && parsed.chapter === chapterNum && parsed.verse === verseNum) {
                return true;
            }
        }
        
        // 3. Fallback to default insights or unresolved books
        const resolvedBook = resolveBookName(insight.parasha) || "דברים";
        if (resolvedBook === bookHeb && insight.chapter === chapterNum && insight.verseNum) {
            const numericVerse = calculateGematria(insight.verseNum);
            if (numericVerse === verseNum) {
                return true;
            }
        }
        
        return false;
    });
}

// --- Helper: Copy Plain Text Without Formatting ---
window.copyPlainText = function(text, btnElement) {
    if (!text) return;
    
    function onSuccess() {
        if (!btnElement) return;
        const origContent = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-check" style="color: #22c55e;"></i> הועתק!';
        btnElement.style.borderColor = '#22c55e';
        setTimeout(() => {
            btnElement.innerHTML = origContent;
            btnElement.style.borderColor = '';
        }, 1800);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }

    function fallbackCopy(str) {
        const ta = document.createElement('textarea');
        ta.value = str;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            onSuccess();
        } catch (e) {
            console.error('Copy plain text failed', e);
        }
        document.body.removeChild(ta);
    }
};

// --- Helper: Parse Search Query for Coordinate Matching ---
function parseSearchQueryReference(query) {
    if (!query) return null;
    const clean = query.trim();
    
    // Find if it starts with any known book name
    for (let key in SefariaBookMap) {
        if (clean.includes(key)) {
            const rawNumbers = clean.substring(clean.indexOf(key) + key.length).match(/([א-ת]+|\d+)/g);
            const bookHeb = key;
            const book = SefariaBookMap[key];
            if (rawNumbers) {
                const numbers = rawNumbers.filter(n => !["פרק", "פרקים", "פסוק", "פסוקים", "פרשה", "פרשת"].includes(n));
                if (numbers && numbers.length > 0) {
                    const chapter = isNaN(numbers[0]) ? calculateGematria(numbers[0]) : parseInt(numbers[0]);
                    const verse = numbers.length > 1 ? (isNaN(numbers[1]) ? calculateGematria(numbers[1]) : parseInt(numbers[1])) : null;
                    return { book, chapter, verse, bookHeb };
                }
            }
            return { book, chapter: null, verse: null, bookHeb };
        }
    }
    return null;
}

// --- Offline Tanakh Indexing Engine ---
function initOfflineTanakh() {
    if (typeof TanakhData === 'undefined') {
        console.warn("Offline TanakhData is not loaded. Offline features disabled.");
        return;
    }
    
    console.time("Indexing Tanakh");
    const bookOrder = [
        "Gen", "Exod", "Lev", "Num", "Deut",
        "Josh", "Judg", "1Sam", "2Sam", "1Kgs", "2Kgs",
        "Isa", "Jer", "Ezek",
        "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
        "Ps", "Prov", "Job", "Song", "Ruth", "Lam", "Eccl", "Esth", "Dan", "Ezra", "Neh", "1Chr", "2Chr"
    ];
    const bookNames = Object.keys(TanakhData).sort((a, b) => bookOrder.indexOf(a) - bookOrder.indexOf(b));
    
    const RikarttToHebrewMap = {
        "Gen": { eng: "Genesis", heb: "בראשית" },
        "Exod": { eng: "Exodus", heb: "שמות" },
        "Lev": { eng: "Leviticus", heb: "ויקרא" },
        "Num": { eng: "Numbers", heb: "במדבר" },
        "Deut": { eng: "Deuteronomy", heb: "דברים" },
        "Josh": { eng: "Joshua", heb: "יהושע" },
        "Judg": { eng: "Judges", heb: "שופטים" },
        "1Sam": { eng: "I Samuel", heb: "שמואל א" },
        "2Sam": { eng: "II Samuel", heb: "שמואל ב" },
        "1Kgs": { eng: "I Kings", heb: "מלכים א" },
        "2Kgs": { eng: "II Kings", heb: "מלכים ב" },
        "Isa": { eng: "Isaiah", heb: "ישעיהו" },
        "Jer": { eng: "Jeremiah", heb: "ירמיהו" },
        "Ezek": { eng: "Ezekiel", heb: "יחזקאל" },
        "Hos": { eng: "Hosea", heb: "הושע" },
        "Joel": { eng: "Joel", heb: "יואל" },
        "Amos": { eng: "Amos", heb: "עמוס" },
        "Obad": { eng: "Obadiah", heb: "עובדיה" },
        "Jonah": { eng: "Jonah", heb: "יונה" },
        "Mic": { eng: "Micah", heb: "מיכה" },
        "Nah": { eng: "Nahum", heb: "נחום" },
        "Hab": { eng: "Habakkuk", heb: "חבקוק" },
        "Zeph": { eng: "Zephaniah", heb: "צפניה" },
        "Hag": { eng: "Haggai", heb: "חגי" },
        "Zech": { eng: "Zechariah", heb: "זכריה" },
        "Mal": { eng: "Malachi", heb: "מלאכי" },
        "Ps": { eng: "Psalms", heb: "תהילים" },
        "Prov": { eng: "Proverbs", heb: "משלי" },
        "Job": { eng: "Job", heb: "איוב" },
        "Song": { eng: "Song of Songs", heb: "שיר השירים" },
        "Ruth": { eng: "Ruth", heb: "רות" },
        "Lam": { eng: "Lamentations", heb: "איכה" },
        "Eccl": { eng: "Ecclesiastes", heb: "קהלת" },
        "Esth": { eng: "Esther", heb: "אסתר" },
        "Dan": { eng: "Daniel", heb: "דניאל" },
        "Ezra": { eng: "Ezra", heb: "עזרא" },
        "Neh": { eng: "Nehemiah", heb: "נחמיה" },
        "1Chr": { eng: "I Chronicles", heb: "דברי הימים א" },
        "2Chr": { eng: "II Chronicles", heb: "דברי הימים ב" }
    };

    const verses = [];
    for (let rBook of bookNames) {
        const bookInfo = RikarttToHebrewMap[rBook];
        if (!bookInfo) continue;
        
        const bookData = TanakhData[rBook];
        for (let c = 0; c < bookData.length; c++) {
            const chapterData = bookData[c];
            for (let v = 0; v < chapterData.length; v++) {
                const words = chapterData[v];
                const cleanWords = words.filter(w => w !== 'ס' && w !== 'פ');
                const rawText = cleanWords.join(" ");
                const cleanText = stripNikud(rawText);
                
                verses.push({
                    bookEng: bookInfo.eng,
                    bookHeb: bookInfo.heb,
                    chapter: c + 1,
                    verse: v + 1,
                    originalText: rawText,
                    cleanText: cleanText,
                    gematria: calculateGematria(cleanText)
                });
            }
        }
    }
    State.tanakhVerses = verses;

    // Merge any admin-edited verses over the originals
    if (Object.keys(State.editedVerses).length > 0) {
        State.tanakhVerses.forEach(v => {
            const key = `${v.bookHeb}|${v.chapter}|${v.verse}`;
            if (State.editedVerses[key]) {
                const edited = State.editedVerses[key];
                v.originalText = edited.originalText;
                v.cleanText = stripNikud(edited.originalText);
                v.gematria = calculateGematria(v.cleanText);
            }
        });
    }

    console.timeEnd("Indexing Tanakh");
    console.log(`Indexed ${State.tanakhVerses.length} verses from local Tanakh.`);
}

// --- Sefaria API Tanakh Integration ---
const SefariaBookMap = {
    "בראשית": "Genesis", "שמות": "Exodus", "ויקרא": "Leviticus", "במדבר": "Numbers", "דברים": "Deuteronomy",
    "יהושע": "Joshua", "שופטים": "Judges", "שמואל א": "I Samuel", "שמואל ב": "II Samuel", "מלכים א": "I Kings", "מלכים ב": "II Kings",
    "ישעיהו": "Isaiah", "ירמיהו": "Jeremiah", "יחזקאל": "Ezekiel", "הושע": "Hosea", "יואל": "Joel", "עמוס": "Amos",
    "עובדיה": "Obadiah", "יונה": "Jonah", "מיכה": "Micah", "נחום": "Nahum", "חבקוק": "Habakkuk", "צפניה": "Zephaniah",
    "חגי": "Haggai", "זכריה": "Zechariah", "מלאכי": "Malachi", "תהלים": "Psalms", "תהילים": "Psalms", "משלי": "Proverbs", "איוב": "Job",
    "שיר השירים": "Song of Songs", "רות": "Ruth", "איכה": "Lamentations", "קהלת": "Ecclesiastes", "אסתר": "Esther",
    "דניאל": "Daniel", "עזרא": "Ezra", "נחמיה": "Nehemiah", "דברי הימים א": "I Chronicles", "דברי הימים ב": "II Chronicles"
};

const TorahBooks = ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"];
const NachBooks = ["יהושע", "שופטים", "שמואל א", "שמואל ב", "מלכים א", "מלכים ב", "ישעיהו", "ירמיהו", "יחזקאל", "הושע", "יואל", "עמוס", "עובדיה", "יונה", "מיכה", "נחום", "חבקוק", "צפניה", "חגי", "זכריה", "מלאכי", "תהלים", "משלי", "איוב", "שיר השירים", "רות", "איכה", "קהלת", "אסתר", "דניאל", "עזרא", "נחמיה", "דברי הימים א", "דברי הימים ב"];

function updateStudyToolbar(category) {
    const bookSelect = document.getElementById('study-book-select');
    const chapSelect = document.getElementById('study-chapter-select');
    if (!bookSelect || !chapSelect) return;

    bookSelect.innerHTML = '<option value="all">כל הספרים</option>';
    chapSelect.innerHTML = '<option value="all">כל הפרקים</option>';
    
    let booksToLoad = [];
    if (category === 'תורה') booksToLoad = TorahBooks;
    else if (category === 'נך' || category === 'נ"ך') booksToLoad = NachBooks;
    else if (category === 'all') booksToLoad = [...TorahBooks, ...NachBooks];
    
    if (booksToLoad.length > 0) {
        booksToLoad.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.innerText = b;
            bookSelect.appendChild(opt);
        });
        document.getElementById('book-chapter-toolbar').style.display = 'flex';
    } else {
        document.getElementById('book-chapter-toolbar').style.display = 'none';
    }
}

function updateChapterDropdown(bookHeb) {
    const chapSelect = document.getElementById('study-chapter-select');
    if (!chapSelect) return;
    chapSelect.innerHTML = '<option value="all">כל הפרקים</option>';
    if (bookHeb === 'all' || !State.tanakhVerses) return;
    
    const versesInBook = State.tanakhVerses.filter(v => v.bookHeb === bookHeb);
    if (versesInBook.length === 0) return;
    
    const maxChap = Math.max(...versesInBook.map(v => v.chapter));
    for (let i = 1; i <= maxChap; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = "פרק " + numberToHebrew(i);
        chapSelect.appendChild(opt);
    }
}

// --- Helpers for dynamic Torah/Tanakh book name resolution ---
function getTorahBookOfParasha(parashaName) {
    if (!parashaName) return null;
    const p = parashaName.trim().replace("פרשת ", "");
    
    // Map of Torah books to their parashot
    const TorahParashot = {
        "בראשית": ["בראשית", "נח", "לך לך", "לך-לך", "וירא", "חיי שרה", "תולדות", "ויצא", "וישלח", "וישב", "מקץ", "ויגש", "ויחי"],
        "שמות": ["שמות", "וארא", "בא", "בשלח", "יתרו", "משפטים", "תרומה", "תצוה", "כי תשא", "כי-תשא", "ויקהל", "פקודי"],
        "ויקרא": ["ויקרא", "צו", "שמיני", "תזריע", "מצורע", "אחרי מות", "קדושים", "אמור", "בהר", "בחוקותי", "בחקתי"],
        "במדבר": ["במדבר", "נשא", "בהעלותך", "שלח", "שלח לך", "קרח", "חקת", "בלק", "פנחס", "מטות", "מסעי"],
        "דברים": ["דברים", "ואתחנן", "עקב", "ראה", "שופטים", "כי תצא", "כי-תצא", "כי תבוא", "כי-תבוא", "נצבים", "וילך", "האזינו", "וזאת הברכה"]
    };
    
    for (let book in TorahParashot) {
        if (TorahParashot[book].some(item => p.includes(item) || item.includes(p))) {
            return book;
        }
    }
    return null;
}

function resolveBookName(text) {
    if (!text) return null;
    const clean = text.trim();
    // 1. Try finding if it matches a Torah parasha
    const torahBook = getTorahBookOfParasha(clean);
    if (torahBook) return torahBook;
    
    // 2. Try finding if it contains a book name directly
    for (let key in SefariaBookMap) {
        if (clean.includes(key)) {
            return key;
        }
    }
    return null;
}

function parseHebrewReference(refText) {
    if (!refText) return null;
    const clean = refText.trim();
    
    // Format 1: "דברים ג, כג" or "דברים ג כג" or "דברים ג:כג"
    const regex1 = /^([א-ת\s\d]+)\s+([א-ת]+|\d+)[,:\s]+\s*([א-ת]+|\d+)$/;
    const match1 = clean.match(regex1);
    if (match1) {
        const bookHeb = match1[1].trim();
        const chapHeb = match1[2].trim();
        const verseHeb = match1[3].trim();
        
        const book = SefariaBookMap[bookHeb];
        if (book) {
            const chapter = isNaN(chapHeb) ? calculateGematria(chapHeb) : parseInt(chapHeb);
            const verse = isNaN(verseHeb) ? calculateGematria(verseHeb) : parseInt(verseHeb);
            return { book, chapter, verse, bookHeb };
        }
    }
    
    // Format 2: "דברים פרק ג פסוק כג"
    const regex2 = /^([א-ת\s\d]+)\s+פרק\s+([א-ת]+|\d+)\s+פסוק\s+([א-ת]+|\d+)$/;
    const match2 = clean.match(regex2);
    if (match2) {
        const bookHeb = match2[1].trim();
        const chapHeb = match2[2].trim();
        const verseHeb = match2[3].trim();
        
        const book = SefariaBookMap[bookHeb];
        if (book) {
            const chapter = isNaN(chapHeb) ? calculateGematria(chapHeb) : parseInt(chapHeb);
            const verse = isNaN(verseHeb) ? calculateGematria(verseHeb) : parseInt(verseHeb);
            return { book, chapter, verse, bookHeb };
        }
    }
    
    // Loose check
    for (let key in SefariaBookMap) {
        if (clean.startsWith(key)) {
            const rawNumbers = clean.substring(key.length).match(/([א-ת]+|\d+)/g);
            if (rawNumbers) {
                const numbers = rawNumbers.filter(n => !["פרק", "פרקים", "פסוק", "פסוקים", "פרשה", "פרשת"].includes(n));
                if (numbers && numbers.length >= 2) {
                    const book = SefariaBookMap[key];
                    const chapter = isNaN(numbers[0]) ? calculateGematria(numbers[0]) : parseInt(numbers[0]);
                    const verse = isNaN(numbers[1]) ? calculateGematria(numbers[1]) : parseInt(numbers[1]);
                    return { book, chapter, verse, bookHeb: key };
                }
            }
        }
    }
    return null;
}

async function fetchTanakhVerse(refText) {
    const parsed = parseHebrewReference(refText);
    if (!parsed) return null;
    
    // First try retrieving from the local offline TanakhData dataset
    if (typeof TanakhData !== 'undefined') {
        const RikarttBookMap = {
            "Genesis": "Gen", "Exodus": "Exod", "Leviticus": "Lev", "Numbers": "Num", "Deuteronomy": "Deut",
            "Joshua": "Josh", "Judges": "Judg", "I Samuel": "1Sam", "II Samuel": "2Sam", "I Kings": "1Kgs", "II Kings": "2Kgs",
            "Isaiah": "Isa", "Jeremiah": "Jer", "Ezekiel": "Ezek", "Hosea": "Hos", "Joel": "Joel", "Amos": "Amos",
            "Obadiah": "Obad", "Jonah": "Jonah", "Micah": "Mic", "Nahum": "Nah", "Habakkuk": "Hab", "Zephaniah": "Zeph",
            "Haggai": "Hag", "Zechariah": "Zech", "Malachi": "Mal", "Psalms": "Ps", "Proverbs": "Prov", "Job": "Job",
            "Song of Songs": "Song", "Ruth": "Ruth", "Lamentations": "Lam", "Ecclesiastes": "Eccl", "Esther": "Esth",
            "Daniel": "Dan", "Ezra": "Ezra", "Nehemiah": "Neh", "I Chronicles": "1Chr", "II Chronicles": "2Chr"
        };
        const rBook = RikarttBookMap[parsed.book];
        if (rBook && TanakhData[rBook]) {
            const bookData = TanakhData[rBook];
            const chapIdx = parsed.chapter - 1;
            const verseIdx = parsed.verse - 1;
            if (bookData[chapIdx] && bookData[chapIdx][verseIdx]) {
                const words = bookData[chapIdx][verseIdx];
                // Filter out section markers like "ס" or "פ"
                const cleanWords = words.filter(w => w !== 'ס' && w !== 'פ');
                const offlineVerse = cleanWords.join(" ");
                if (offlineVerse) {
                    console.log(`Loaded verse ${parsed.book} ${parsed.chapter}:${parsed.verse} offline`);
                    return offlineVerse;
                }
            }
        }
    }
    
    // Fall back to Sefaria API if the local dataset is missing or doesn't have the verse
    console.log(`Verse not found offline or dataset missing, fetching from Sefaria API for ${parsed.book} ${parsed.chapter}:${parsed.verse}`);
    const url = `https://api.sefaria.org/api/texts/${parsed.book}.${parsed.chapter}.${parsed.verse}?context=0`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const json = await res.json();
        if (json && json.he) {
            const rawHe = Array.isArray(json.he) ? json.he.join(' ') : json.he;
            return rawHe.replace(/<\/?[^>]+(>|$)/g, "").trim();
        }
    } catch (err) {
        console.error("Error fetching verse from Sefaria: ", err);
    }
    return null;
}

// --- Local Storage Sync ---
function loadLocalStorage() {
    const bookmarks = localStorage.getItem('torah_bookmarks');
    if (bookmarks) State.bookmarks = JSON.parse(bookmarks);

    const comments = localStorage.getItem('torah_comments');
    if (comments) State.comments = JSON.parse(comments);

    const upvotes = localStorage.getItem('torah_upvotes');
    if (upvotes) State.upvotes = JSON.parse(upvotes);

    const userInsights = localStorage.getItem('torah_user_insights');
    if (userInsights) State.userInsights = JSON.parse(userInsights);

    const uploadedInsights = localStorage.getItem('torah_uploaded_insights');
    if (uploadedInsights) State.uploadedInsights = JSON.parse(uploadedInsights);

    const streak = localStorage.getItem('torah_streak');
    if (streak) {
        State.userStreak = parseInt(streak);
    } else {
        localStorage.setItem('torah_streak', State.userStreak);
    }

    const bgTheme = localStorage.getItem('torah_bg') || 'parchment';
    State.bgTheme = bgTheme;
    document.body.setAttribute('data-bg', bgTheme);

    const textTheme = localStorage.getItem('torah_text') || 'espresso';
    State.textTheme = textTheme;
    document.body.setAttribute('data-text', textTheme);

    const sharedVerse = localStorage.getItem('torah_shared_verse');
    if (sharedVerse) {
        State.sharedVerse = sharedVerse;
    }

    const searchHistory = localStorage.getItem('torah_search_history');
    if (searchHistory) {
        try {
            State.searchHistory = JSON.parse(searchHistory);
        } catch (e) {
            console.error("Failed to parse search history", e);
        }
    }

    const role = localStorage.getItem('torah_user_role');
    if (role) {
        State.userRole = role;
    } else {
        State.userRole = 'user';
    }

    const pending = localStorage.getItem('torah_pending_requests');
    if (pending) State.pendingRequests = JSON.parse(pending);

    const deletedDefaults = localStorage.getItem('torah_deleted_default_ids');
    if (deletedDefaults) State.deletedDefaultIds = JSON.parse(deletedDefaults);

    const editedDefaults = localStorage.getItem('torah_edited_default_insights');
    if (editedDefaults) State.editedDefaultInsights = JSON.parse(editedDefaults);

    const editedVerses = localStorage.getItem('torah_edited_verses');
    if (editedVerses) State.editedVerses = JSON.parse(editedVerses);
}

function saveLocalStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    updateStats();
    saveToServer(key, data);
}

async function loadFromServer() {
    try {
        const response = await fetch('/api/get_data');
        if (!response.ok) return;
        const data = await response.json();
        
        let hasChanges = false;
        let needsUpload = false;
        const uploadPayload = {};

        // 1. Bookmarks
        const serverBookmarks = data.torah_bookmarks || [];
        const mergedBookmarks = Array.from(new Set([...State.bookmarks, ...serverBookmarks]));
        if (JSON.stringify(State.bookmarks) !== JSON.stringify(mergedBookmarks) || JSON.stringify(serverBookmarks) !== JSON.stringify(mergedBookmarks)) {
            State.bookmarks = mergedBookmarks;
            localStorage.setItem('torah_bookmarks', JSON.stringify(State.bookmarks));
            hasChanges = true;
            if (JSON.stringify(serverBookmarks) !== JSON.stringify(mergedBookmarks)) {
                uploadPayload['torah_bookmarks'] = mergedBookmarks;
                needsUpload = true;
            }
        }

        // 2. Comments
        const serverComments = data.torah_comments || {};
        const mergedComments = { ...serverComments };
        for (let id in State.comments) {
            if (!mergedComments[id]) {
                mergedComments[id] = State.comments[id];
            } else {
                const serverCommentStrings = new Set(mergedComments[id].map(c => `${c.name}:${c.text}`));
                State.comments[id].forEach(c => {
                    if (!serverCommentStrings.has(`${c.name}:${c.text}`)) {
                        mergedComments[id].push(c);
                    }
                });
            }
        }
        if (JSON.stringify(State.comments) !== JSON.stringify(mergedComments) || JSON.stringify(serverComments) !== JSON.stringify(mergedComments)) {
            State.comments = mergedComments;
            localStorage.setItem('torah_comments', JSON.stringify(State.comments));
            hasChanges = true;
            if (JSON.stringify(serverComments) !== JSON.stringify(mergedComments)) {
                uploadPayload['torah_comments'] = mergedComments;
                needsUpload = true;
            }
        }

        // 3. Upvotes
        const serverUpvotes = data.torah_upvotes || {};
        const mergedUpvotes = { ...serverUpvotes };
        for (let id in State.upvotes) {
            mergedUpvotes[id] = Math.max(State.upvotes[id] || 0, mergedUpvotes[id] || 0);
        }
        if (JSON.stringify(State.upvotes) !== JSON.stringify(mergedUpvotes) || JSON.stringify(serverUpvotes) !== JSON.stringify(mergedUpvotes)) {
            State.upvotes = mergedUpvotes;
            localStorage.setItem('torah_upvotes', JSON.stringify(State.upvotes));
            hasChanges = true;
            if (JSON.stringify(serverUpvotes) !== JSON.stringify(mergedUpvotes)) {
                uploadPayload['torah_upvotes'] = mergedUpvotes;
                needsUpload = true;
            }
        }

        // 4. User Insights
        const serverUserInsights = data.torah_user_insights || [];
        const mergedUserInsights = [...serverUserInsights];
        const serverUserIds = new Set(serverUserInsights.map(item => item.id));
        State.userInsights.forEach(item => {
            if (!serverUserIds.has(item.id)) {
                mergedUserInsights.push(item);
            }
        });
        if (JSON.stringify(State.userInsights) !== JSON.stringify(mergedUserInsights) || JSON.stringify(serverUserInsights) !== JSON.stringify(mergedUserInsights)) {
            State.userInsights = mergedUserInsights;
            localStorage.setItem('torah_user_insights', JSON.stringify(State.userInsights));
            hasChanges = true;
            if (JSON.stringify(serverUserInsights) !== JSON.stringify(mergedUserInsights)) {
                uploadPayload['torah_user_insights'] = mergedUserInsights;
                needsUpload = true;
            }
        }

        // 5. Uploaded Insights
        const serverUploadedInsights = data.torah_uploaded_insights || [];
        const mergedUploadedInsights = [...serverUploadedInsights];
        const serverUploadedIds = new Set(serverUploadedInsights.map(item => item.id));
        State.uploadedInsights.forEach(item => {
            if (!serverUploadedIds.has(item.id)) {
                mergedUploadedInsights.push(item);
            }
        });
        if (JSON.stringify(State.uploadedInsights) !== JSON.stringify(mergedUploadedInsights) || JSON.stringify(serverUploadedInsights) !== JSON.stringify(mergedUploadedInsights)) {
            State.uploadedInsights = mergedUploadedInsights;
            localStorage.setItem('torah_uploaded_insights', JSON.stringify(State.uploadedInsights));
            hasChanges = true;
            if (JSON.stringify(serverUploadedInsights) !== JSON.stringify(mergedUploadedInsights)) {
                uploadPayload['torah_uploaded_insights'] = mergedUploadedInsights;
                needsUpload = true;
            }
        }

        // 6. Streak
        const serverStreak = data.torah_streak ? parseInt(data.torah_streak) : 3;
        const mergedStreak = Math.max(State.userStreak, serverStreak);
        if (State.userStreak !== mergedStreak || serverStreak !== mergedStreak) {
            State.userStreak = mergedStreak;
            localStorage.setItem('torah_streak', State.userStreak.toString());
            hasChanges = true;
            if (serverStreak !== mergedStreak) {
                uploadPayload['torah_streak'] = mergedStreak;
                needsUpload = true;
            }
        }

        // 7. Pending Requests
        const serverPending = data.torah_pending_requests || [];
        const mergedPending = [...serverPending];
        const serverPendingIds = new Set(serverPending.map(item => item.id));
        State.pendingRequests.forEach(item => {
            if (!serverPendingIds.has(item.id)) {
                mergedPending.push(item);
            }
        });
        if (JSON.stringify(State.pendingRequests) !== JSON.stringify(mergedPending) || JSON.stringify(serverPending) !== JSON.stringify(mergedPending)) {
            State.pendingRequests = mergedPending;
            localStorage.setItem('torah_pending_requests', JSON.stringify(State.pendingRequests));
            hasChanges = true;
            if (JSON.stringify(serverPending) !== JSON.stringify(mergedPending)) {
                uploadPayload['torah_pending_requests'] = mergedPending;
                needsUpload = true;
            }
        }

        // 8. Deleted Default IDs
        const serverDeleted = data.torah_deleted_default_ids || [];
        const mergedDeleted = Array.from(new Set([...State.deletedDefaultIds, ...serverDeleted]));
        if (JSON.stringify(State.deletedDefaultIds) !== JSON.stringify(mergedDeleted) || JSON.stringify(serverDeleted) !== JSON.stringify(mergedDeleted)) {
            State.deletedDefaultIds = mergedDeleted;
            localStorage.setItem('torah_deleted_default_ids', JSON.stringify(State.deletedDefaultIds));
            hasChanges = true;
            if (JSON.stringify(serverDeleted) !== JSON.stringify(mergedDeleted)) {
                uploadPayload['torah_deleted_default_ids'] = mergedDeleted;
                needsUpload = true;
            }
        }

        // 9. Edited Default Insights
        const serverEdited = data.torah_edited_default_insights || {};
        const mergedEdited = { ...serverEdited, ...State.editedDefaultInsights };
        if (JSON.stringify(State.editedDefaultInsights) !== JSON.stringify(mergedEdited) || JSON.stringify(serverEdited) !== JSON.stringify(mergedEdited)) {
            State.editedDefaultInsights = mergedEdited;
            localStorage.setItem('torah_edited_default_insights', JSON.stringify(State.editedDefaultInsights));
            hasChanges = true;
            if (JSON.stringify(serverEdited) !== JSON.stringify(mergedEdited)) {
                uploadPayload['torah_edited_default_insights'] = mergedEdited;
                needsUpload = true;
            }
        }
        
        if (hasChanges) {
            updateStats();
        }

        if (needsUpload) {
            console.log("Uploading merged local state to server...", uploadPayload);
            await fetch('/api/save_data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(uploadPayload)
            });
        }
    } catch (err) {
        console.warn("Failed to load data from server. Working in offline mode:", err);
    }
}

async function saveToServer(key, data) {
    try {
        const payload = {};
        payload[key] = data;
        await fetch('/api/save_data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.error("Failed to save data to server:", err);
    }
}

// --- Navigation Controller ---
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const pageViews = document.querySelectorAll('.page-view');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetId = link.getAttribute('data-target');
            
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            pageViews.forEach(view => {
                if (view.id === targetId) {
                    view.classList.add('active');
                } else {
                    view.classList.remove('active');
                }
            });
            
            State.activeView = targetId;
            
            if (targetId === 'study-hall-view') {
                renderInsightsGrid();
            } else if (targetId === 'library-view') {
                renderLibrary();
            } else if (targetId === 'word-repetition-view') {
                const inp = document.getElementById('word-search-input');
                if (inp) inp.focus();
            } else if (targetId === 'index-view') {
                renderCommentaryIndex();
            } else if (targetId === 'admin-requests-view') {
                renderAdminRequests();
            } else if (targetId === 'admin-verse-view') {
                initAdminVerseManagement();
            }
            
            // Sync shared verse inputs and render panel histories
            syncSharedVerseAndRenderHistories(targetId);
        });
    });

    // Role Switcher Setup
    const roleSelector = document.getElementById('role-selector');
    if (roleSelector) {
        roleSelector.value = State.userRole;
        roleSelector.addEventListener('change', (e) => {
            State.userRole = e.target.value;
            localStorage.setItem('torah_user_role', State.userRole);
            applyRoleSettings();
            
            // Re-render current grids/views to update buttons and sections
            if (State.activeView === 'study-hall-view') {
                renderInsightsGrid();
            } else if (State.activeView === 'insight-reader-view') {
                if (State.selectedInsightId) {
                    openInsightReader(State.selectedInsightId);
                }
            } else if (State.activeView === 'library-view') {
                renderLibrary();
            } else if (State.activeView === 'admin-requests-view' && State.userRole !== 'admin') {
                // If on admin view but switched to user, redirect
                switchView('study-hall-view');
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'study-hall-view') {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            } else if ((State.activeView === 'admin-verse-view') && State.userRole !== 'admin') {
                // If on admin verse view but switched to user, redirect
                switchView('study-hall-view');
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'study-hall-view') {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            } else if (State.activeView === 'admin-requests-view') {
                renderAdminRequests();
            } else if (State.activeView === 'admin-verse-view') {
                initAdminVerseManagement();
            }
        });
    }

    // Theme Selectors (Split BG / Text)
    const bgSelector = document.getElementById('bg-selector');
    if (bgSelector) {
        bgSelector.value = State.bgTheme;
        bgSelector.addEventListener('change', (e) => {
            State.bgTheme = e.target.value;
            document.body.setAttribute('data-bg', State.bgTheme);
            localStorage.setItem('torah_bg', State.bgTheme);
        });
    }

    const textSelector = document.getElementById('text-selector');
    if (textSelector) {
        textSelector.value = State.textTheme;
        textSelector.addEventListener('change', (e) => {
            State.textTheme = e.target.value;
            document.body.setAttribute('data-text', State.textTheme);
            localStorage.setItem('torah_text', State.textTheme);
        });
    }

    // Back to Study Hall
    document.getElementById('back-to-hall').addEventListener('click', () => {
        switchView('study-hall-view');
        // Activate correct nav tab
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('data-target') === 'study-hall-view') {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    });
}

function switchView(viewId) {
    const pageViews = document.querySelectorAll('.page-view');
    pageViews.forEach(view => {
        if (view.id === viewId) {
            view.classList.add('active');
        } else {
            view.classList.remove('active');
        }
    });
    State.activeView = viewId;
}

function applyRoleSettings() {
    const adminElements = document.querySelectorAll('.admin-only');
    const userElements = document.querySelectorAll('.user-only');
    
    if (State.userRole === 'admin') {
        adminElements.forEach(el => {
            if (el.tagName === 'BUTTON' || el.tagName === 'NAV' || el.tagName === 'SPAN') {
                el.style.display = 'inline-block';
            } else if (el.tagName === 'DIV' || el.tagName === 'SECTION') {
                el.style.display = 'block';
            } else {
                el.style.display = 'flex';
            }
        });
        userElements.forEach(el => {
            el.style.display = 'none';
        });
        
        // Scribe Desk updates
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
            publishBtn.innerHTML = '<i class="fa-solid fa-feather"></i> פרסם מיד בהיכל';
        }
        
        renderAdminRequestsBadge();
    } else {
        adminElements.forEach(el => {
            el.style.display = 'none';
        });
        userElements.forEach(el => {
            if (el.tagName === 'BUTTON' || el.tagName === 'SPAN') {
                el.style.display = 'inline-block';
            } else {
                el.style.display = 'block';
            }
        });
        
        // Scribe Desk updates
        const publishBtn = document.getElementById('publish-btn');
        if (publishBtn) {
            publishBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> שלח בקשת פרסום';
        }
    }
}

function renderAdminRequestsBadge() {
    const badge = document.getElementById('pending-requests-badge');
    if (!badge) return;
    const pendingCount = State.pendingRequests.filter(r => r.status === 'pending').length;
    if (pendingCount > 0 && State.userRole === 'admin') {
        badge.innerText = pendingCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function updateThemeSelectorValue() {
    const bgSel = document.getElementById('bg-selector');
    if (bgSel) bgSel.value = State.bgTheme;
    const textSel = document.getElementById('text-selector');
    if (textSel) textSel.value = State.textTheme;
}

// --- Data Loading & Initialization ---
async function loadDefaultData() {
    try {
        let combinedInsights = [];
        
        // Use pre-parsed dataset from data.js if available (bypasses CORS restrictions on local file:// protocol)
        if (typeof defaultInsights !== 'undefined' && Array.isArray(defaultInsights)) {
            combinedInsights = defaultInsights;
            console.log("Loaded commentaries from pre-compiled data.js");
        } else {
            const files = ['פרשת ואתחנן חלק א.txt', 'פרשת ואתחנן חלק ג.txt'];
            for (let file of files) {
                const response = await fetch(encodeURIComponent(file));
                if (!response.ok) {
                    console.warn(`Failed to fetch local file ${file}, status: ${response.status}`);
                    continue;
                }
                const rawText = await response.text();
                const parsed = parseTorahText(rawText);
                
                // Assign unique ID to each parsed insight
                const filePrefix = file.includes('חלק א') ? 'vaetchanan_a' : 'vaetchanan_c';
                
                let fileChapter = null;
                const rangeMatch = (parsed.versesRange || "").match(/פרק\s+([א-ת]+|\d+)/) || (parsed.subTitle || "").match(/פרק\s+([א-ת]+|\d+)/) || (parsed.title || "").match(/פרק\s+([א-ת]+|\d+)/);
                if (rangeMatch) {
                    const chapStr = rangeMatch[1];
                    fileChapter = isNaN(chapStr) ? calculateGematria(chapStr) : parseInt(chapStr);
                }

                parsed.insights.forEach((insight, idx) => {
                    insight.id = `${filePrefix}_v_${insight.verseNum || idx}`;
                    insight.author = "מערכת בית המדרש";
                    insight.parasha = "ואתחנן";
                    if (fileChapter) insight.chapter = fileChapter;
                    combinedInsights.push(insight);
                });

                parsed.essays.forEach((essay, idx) => {
                    essay.id = `${filePrefix}_e_${idx}`;
                    essay.author = "מערכת בית המדרש";
                    essay.parasha = "ואתחנן";
                    // Convert general essays to insights for uniform displaying in grid if they have long content
                    if (essay.content.length > 50) {
                        combinedInsights.push({
                            id: essay.id,
                            verseNum: "",
                            verseText: essay.title,
                            category: "חסידות ומחשבה",
                            author: essay.author,
                            parasha: essay.parasha,
                            interpretations: {
                                peshat: essay.content,
                                remez: "",
                                derash: "",
                                sod: ""
                            },
                            gematria: null,
                            generalInsights: ""
                        });
                    }
                });
            }
        }
        
        // Apply admin edits and deletions to default insights
        combinedInsights = combinedInsights.map(insight => {
            if (State.editedDefaultInsights && State.editedDefaultInsights[insight.id]) {
                return State.editedDefaultInsights[insight.id];
            }
            return insight;
        }).filter(insight => !State.deletedDefaultIds.includes(insight.id));

        // Combine default insights with user insights and uploaded insights
        State.insights = [...combinedInsights, ...State.userInsights, ...State.uploadedInsights];
        
        // Remove duplicates based on ID
        const seen = new Set();
        State.insights = State.insights.filter(item => {
            const k = item.id;
            return seen.has(k) ? false : seen.add(k);
        });

        console.log(`Loaded ${State.insights.length} total insights.`);
        renderInsightsGrid();
        updateStats();
    } catch (e) {
        console.error("Error loading mock data: ", e);
        // Fallback with static sample if loading fails
        loadStaticFallback();
    }
}

function loadStaticFallback() {
    const fallback = [
        {
            id: "fallback_1",
            verseNum: "ד",
            verseText: "שְׁמַע יִשְׂרָאֵל יְהֹוָה אֱלֹהֵינוּ יְהֹוָה אֶחָד.",
            category: "תורה",
            author: "מערכת בית המדרש",
            parasha: "ואתחנן",
            interpretations: {
                peshat: "קבלת עול מלכות שמיים והצהרת הייחוד הגמור של הבורא.",
                remez: "האות ע' במילה שמע והד' במילה אחד מוגדלות ליצור יחד את המילה 'עד'.",
                derash: "יעקב אבינו אמר לבניו לפני מותו ושאל אותם אם לבם שלם, וענו לו כולם יחד: שמע ישראל אלוהינו אחד.",
                sod: "רמז ל-25 אותיות הפסוק לעומת 24 אותיות ברוך שם כבוד מלכותו."
            },
            gematria: {
                value: 1118,
                connections: [
                    {
                        verseText: "יְהֹוָ֥ה הוֹשִׁ֑יעָה הַ֝מֶּ֗לֶךְ יַעֲנֵ֥נוּ בְיוֹם־קָרְאֵֽנוּ",
                        source: "תהילים כ, י",
                        explanation: "מענה אלוהי מלמעלה מתעורר בעקבות קריאת האדם מלמטה ביחוד ה'."
                    }
                ],
                explanation: "הגימטריה 1118 מחברת בין קריאת שמע לקריאת הישועה."
            },
            generalInsights: "קריאת שמע היא שבועת הנצח של עם ישראל השומרת עלינו בכל הדורות."
        }
    ];
    let combinedFallback = fallback.map(insight => {
        if (State.editedDefaultInsights && State.editedDefaultInsights[insight.id]) {
            return State.editedDefaultInsights[insight.id];
        }
        return insight;
    }).filter(insight => !State.deletedDefaultIds.includes(insight.id));
    State.insights = [...combinedFallback, ...State.userInsights, ...State.uploadedInsights];
    renderInsightsGrid();
    updateStats();
}

// --- Helper to create a card element ---
function createInsightCard(insight, fallbackBook, fallbackChapter, fallbackVerse) {
    const card = document.createElement('div');
    card.className = 'insight-card';
    card.addEventListener('click', () => openInsightReader(insight.id));
    
    const votes = State.upvotes[insight.id] || 0;
    const commentCount = State.comments[insight.id] ? State.comments[insight.id].length : 0;
    
    let snippetText = insight.interpretations.peshat || insight.generalInsights || "";
    if (snippetText.length > 150) snippetText = snippetText.substring(0, 150) + "...";
    
    const resolvedBook = resolveBookName(insight.parasha) || fallbackBook || "דברים";
    const vNum = insight.verseNum || fallbackVerse;
    const cNum = insight.chapter || fallbackChapter;
    const headingTitle = vNum ? `${resolvedBook} פרק ${numberToHebrew(cNum || 1)}, פסוק ${numberToHebrew(vNum)}` : insight.verseText;
    const sourceLabel = insight.category || "חידוש";
    
    let adminControlsHtml = "";
    if (State.userRole === 'admin') {
        adminControlsHtml = `
            <div class="card-admin-controls">
                <button class="card-admin-btn admin-edit-btn" data-id="${insight.id}"><i class="fa-solid fa-pen-to-square"></i> ערוך</button>
                <button class="card-admin-btn admin-split-btn" data-id="${insight.id}"><i class="fa-solid fa-arrows-split-up-and-left"></i> פצל</button>
                <button class="card-admin-btn admin-delete-btn" style="color: #e53e3e;" data-id="${insight.id}"><i class="fa-solid fa-trash"></i> מחק</button>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-header">
            <span class="card-category">${insight.category}</span>
            <span class="card-date">${sourceLabel}</span>
        </div>
        <h3 class="card-title">${headingTitle}</h3>
        <div class="card-verse">${insight.verseText}</div>
        <p class="card-snippet">${snippetText}</p>
        <div class="card-footer">
            <span class="card-author"><i class="fa-regular fa-user"></i> ${insight.author}</span>
            <div class="card-stats">
                <span class="stat-item"><i class="fa-solid fa-hands-clapping"></i> ${votes}</span>
                <span class="stat-item"><i class="fa-regular fa-comment"></i> ${commentCount}</span>
            </div>
        </div>
        ${adminControlsHtml}
    `;

    if (State.userRole === 'admin') {
        card.querySelector('.admin-edit-btn').addEventListener('click', e => { e.stopPropagation(); openAdvancedEditModal(insight.id); });
        card.querySelector('.admin-split-btn').addEventListener('click', e => { e.stopPropagation(); openSplitCommentaryModal(insight.id); });
        card.querySelector('.admin-delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteCommentary(insight.id); });
    }
    return card;
}

// --- View 1: Render Insights Grid (Study Hall Feed) ---
function renderInsightsGrid() {
    const grid = document.getElementById('insights-grid');
    grid.innerHTML = "";

    const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
    const activeCategory = document.querySelector('.category-tab.active').getAttribute('data-category');
    const sortVal = document.getElementById('sort-select').value;
    
    const bookSelect = document.getElementById('study-book-select');
    const chapSelect = document.getElementById('study-chapter-select');
    const selectedBook = bookSelect && bookSelect.style.display !== 'none' ? bookSelect.value : 'all';
    const selectedChapter = chapSelect && chapSelect.style.display !== 'none' ? chapSelect.value : 'all';

    // If filtering by specific book and chapter, show verses in order
    if (selectedBook !== 'all' && selectedChapter !== 'all') {
        const cNum = parseInt(selectedChapter);
        const verses = State.tanakhVerses.filter(v => v.bookHeb === selectedBook && v.chapter === cNum);
        
        if (verses.length === 0) {
            grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><p>לא נמצאו פסוקים.</p></div>`;
            return;
        }

        // Get insights for this chapter
        const chapterInsights = State.insights.filter(insight => {
            let parsed = parseHebrewReference(insight.verseText);
            if (!parsed) {
                const rb = resolveBookName(insight.parasha);
                if (rb) parsed = { bookHeb: rb, chapter: insight.chapter || 1, verse: insight.verseNum || 1 };
            }
            if (parsed) return parsed.bookHeb === selectedBook && parsed.chapter === cNum;
            return false;
        });
        
        // Group by verse number
        const insightsByVerse = {};
        chapterInsights.forEach(insight => {
            let vNum = 1;
            let parsed = parseHebrewReference(insight.verseText);
            if (parsed) vNum = parsed.verse;
            else if (insight.verseNum) vNum = isNaN(insight.verseNum) ? calculateGematria(insight.verseNum) : parseInt(insight.verseNum);
            
            if (!insightsByVerse[vNum]) insightsByVerse[vNum] = [];
            insightsByVerse[vNum].push(insight);
        });

        const versesWithInsights = [];
        const versesWithoutInsights = [];
        verses.sort((a, b) => a.verse - b.verse);

        verses.forEach(v => {
            if (insightsByVerse[v.verse] && insightsByVerse[v.verse].length > 0) {
                versesWithInsights.push({ verse: v, insights: insightsByVerse[v.verse] });
            } else {
                versesWithoutInsights.push(v);
            }
        });

        // 1. Render verses WITH insights
        versesWithInsights.forEach(item => {
            item.insights.forEach(insight => {
                grid.appendChild(createInsightCard(insight, item.verse.bookHeb, item.verse.chapter, item.verse.verse));
            });
        });

        // 2. Render verses WITHOUT insights (faded)
        versesWithoutInsights.forEach(v => {
            const card = document.createElement('div');
            card.className = 'insight-card';
            card.style.opacity = '0.55';
            card.style.background = 'rgba(0,0,0,0.02)';
            card.style.cursor = 'pointer';
            
            card.addEventListener('click', () => {
                document.getElementById('edit-verse').value = `${v.bookHeb} ${numberToHebrew(v.chapter)}, ${numberToHebrew(v.verse)}`;
                document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                switchView('scribe-desk-view');
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'scribe-desk-view') link.classList.add('active');
                    else link.classList.remove('active');
                });
            });

            card.innerHTML = `
                <div class="card-header">
                    <span class="card-category">פסוק ללא חידוש</span>
                    <span class="card-date">${v.bookHeb}</span>
                </div>
                <h3 class="card-title">${v.bookHeb} פרק ${numberToHebrew(v.chapter)}, פסוק ${numberToHebrew(v.verse)}</h3>
                <div class="card-verse" style="font-size: 1.25rem;">${v.originalText}</div>
                <p class="card-snippet" style="font-style: italic; color: var(--text-muted); text-align: center; margin-top: 1rem;"><i class="fa-solid fa-pen-fancy"></i> לחץ כאן כדי להיות הראשון שמוסיף חידוש על פסוק זה!</p>
            `;
            grid.appendChild(card);
        });

        return;
    }

    // Default Insights Feed (no specific chapter selected)
    const searchRef = parseSearchQueryReference(searchQuery);

    let filtered = State.insights.filter(insight => {
        if (selectedBook !== 'all') {
            let parsed = parseHebrewReference(insight.verseText);
            if (!parsed) {
                const rb = resolveBookName(insight.parasha);
                if (rb) parsed = { bookHeb: rb };
            }
            if (parsed && parsed.bookHeb !== selectedBook) return false;
        }

        if (searchRef) {
            let parsed = parseHebrewReference(insight.verseText);
            if (!parsed) {
                const resolvedBook = resolveBookName(insight.parasha);
                if (resolvedBook) {
                    parsed = { bookHeb: resolvedBook, chapter: insight.chapter || 1, verse: insight.verseNum || 1 };
                } else if (insight.verseNum) {
                    parsed = { bookHeb: "דברים", chapter: insight.chapter || 3, verse: insight.verseNum };
                }
            }
            if (parsed) {
                const bookMatch = parsed.bookHeb === searchRef.bookHeb;
                const chapMatch = searchRef.chapter === null || parsed.chapter === searchRef.chapter;
                const verseMatch = searchRef.verse === null || parsed.verse === searchRef.verse;
                if (bookMatch && chapMatch && verseMatch) return true;
            }
        }

        const matchSearch = 
            (insight.verseText && insight.verseText.toLowerCase().includes(searchQuery)) ||
            (insight.generalInsights && insight.generalInsights.toLowerCase().includes(searchQuery)) ||
            (insight.interpretations.peshat && insight.interpretations.peshat.toLowerCase().includes(searchQuery)) ||
            (insight.author && insight.author.toLowerCase().includes(searchQuery)) ||
            (insight.id && insight.id.toLowerCase().includes(searchQuery));
            
        return matchSearch;
    });

    filtered = filtered.filter(insight => {
        if (activeCategory === 'all') return true;
        if (activeCategory === 'נך') return insight.category === 'נ"ך' || insight.category === 'נך' || insight.category === 'נביאים' || insight.category === 'כתובים';
        return insight.category === activeCategory;
    });

    if (sortVal === 'newest') {
        filtered.sort((a, b) => {
            if (a.id.startsWith('user_') && !b.id.startsWith('user_')) return -1;
            if (!a.id.startsWith('user_') && b.id.startsWith('user_')) return 1;
            return 0;
        });
    } else if (sortVal === 'popular') {
        filtered.sort((a, b) => (State.upvotes[b.id] || 0) - (State.upvotes[a.id] || 0));
    } else if (sortVal === 'length') {
        filtered.sort((a, b) => {
            const lenA = (a.interpretations.peshat || "").length + (a.generalInsights || "").length;
            const lenB = (b.interpretations.peshat || "").length + (b.generalInsights || "").length;
            return lenB - lenA;
        });
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon"><i class="fa-solid fa-seedling"></i></div>
                <p>לא נמצאו חידושים העונים על תנאי הסינון.</p>
                <p style="font-size: 0.85rem; margin-top: 0.5rem;">נסה לחפש מונח אחר או לכתוב חידוש בעצמך!</p>
            </div>
        `;
        return;
    }

    filtered.forEach(insight => {
        grid.appendChild(createInsightCard(insight));
    });
}

// Wire filters and search inputs
function initFilterControls() {
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', renderInsightsGrid);

    const sortSelect = document.getElementById('sort-select');
    sortSelect.addEventListener('change', renderInsightsGrid);

    const tabs = document.querySelectorAll('.category-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            updateStudyToolbar(tab.getAttribute('data-category'));
            renderInsightsGrid();
        });
    });
    
    // Initial setup of toolbar
    updateStudyToolbar('all');
    
    const bookSelect = document.getElementById('study-book-select');
    const chapSelect = document.getElementById('study-chapter-select');
    if (bookSelect) {
        bookSelect.addEventListener('change', (e) => {
            updateChapterDropdown(e.target.value);
            renderInsightsGrid();
        });
    }
    if (chapSelect) {
        chapSelect.addEventListener('change', () => {
            renderInsightsGrid();
        });
    }
}

// --- View 2: Render Reader View (Insight Detail) ---
function openInsightReader(id) {
    const insight = State.insights.find(item => item.id === id);
    if (!insight) return;

    State.selectedInsightId = id;
    switchView('insight-reader-view');

    // Populate metadata
    document.getElementById('reader-category').innerText = insight.category;
    
    let parsedVerse = parseHebrewReference(insight.verseText);
    let vNumDisplay = insight.verseNum;
    if (vNumDisplay && !isNaN(vNumDisplay)) vNumDisplay = numberToHebrew(parseInt(vNumDisplay));
    else if (parsedVerse) vNumDisplay = numberToHebrew(parsedVerse.verse);

    document.getElementById('reader-title').innerText = vNumDisplay ? `ביאור לפסוק ${vNumDisplay}` : insight.verseText;
    document.getElementById('reader-author').innerText = insight.author;
    document.getElementById('reader-parasha').innerText = insight.parasha || "כללי";

    // Populate scripture block
    document.getElementById('reader-verse-text').innerText = insight.verseText;
    if (insight.verseNum || parsedVerse) {
        const bookNameHeb = resolveBookName(insight.parasha) || (parsedVerse ? parsedVerse.bookHeb : "דברים");
        const isTorah = ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"].includes(bookNameHeb);
        const prefixWord = isTorah ? "חומש" : "ספר";
        const parashaPart = (insight.parasha && insight.parasha !== bookNameHeb && !insight.parasha.startsWith("פרשה חיצונית")) ? `, פרשת ${insight.parasha}` : "";
        const cNum = insight.chapter || (parsedVerse ? parsedVerse.chapter : 1);
        const chapterNumHeb = numberToHebrew(cNum);
        document.getElementById('reader-verse-source').innerText = `${prefixWord} ${bookNameHeb}${parashaPart}, פרק ${chapterNumHeb} פסוק ${vNumDisplay}`;
        document.getElementById('reader-verse-block').style.display = 'block';
        
        // Dynamically fetch vocalized Tanakh text from Sefaria API
        const refStr = `${bookNameHeb} ${cNum}, ${insight.verseNum || parsedVerse.verse}`;
        const verseTextElement = document.getElementById('reader-verse-text');
        
        fetchTanakhVerse(refStr).then(vocalizedText => {
            if (vocalizedText) {
                verseTextElement.innerHTML = vocalizedText;
            }
        }).catch(err => console.error("Error fetching vocalized verse: ", err));
    } else {
        document.getElementById('reader-verse-block').style.display = 'block';
        document.getElementById('reader-verse-source').innerText = insight.category;
        
        // Check if we can parse the title as a verse reference
        const parsedRef = parseHebrewReference(insight.verseText);
        if (parsedRef) {
            const verseTextElement = document.getElementById('reader-verse-text');
            fetchTanakhVerse(insight.verseText).then(vocalizedText => {
                if (vocalizedText) {
                    verseTextElement.innerHTML = vocalizedText;
                    document.getElementById('reader-verse-source').innerText = `${parsedRef.bookHeb} פרק ${numberToHebrew(parsedRef.chapter)} פסוק ${numberToHebrew(parsedRef.verse)}`;
                }
            }).catch(err => console.error("Error fetching vocalized verse: ", err));
        }
    }

    // Set font sizes
    applyReaderFontSize();

    // Populate inline commentaries sequentially
    populateInlineCommentaries(insight);

    // Auto Analysis
    runAutoAnalysis(insight.verseText, 'reader-auto-analysis-box');

    // Gematria
    const gemBox = document.getElementById('reader-gematria-box');
    if (insight.gematria) {
        gemBox.style.display = 'block';
        document.getElementById('reader-gematria-val').innerText = insight.gematria.value;
        document.getElementById('reader-gematria-explain').innerText = insight.gematria.explanation || "";
        
        const list = document.getElementById('reader-gematria-list');
        list.innerHTML = "";
        
        if (insight.gematria.connections && insight.gematria.connections.length > 0) {
            insight.gematria.connections.forEach(conn => {
                const li = document.createElement('li');
                li.className = 'gematria-conn-item';
                li.innerHTML = `
                    <div class="gematria-conn-verse">${conn.verseText}</div>
                    <div class="gematria-conn-source">(${conn.source})</div>
                    <div class="gematria-conn-explain">${conn.explanation}</div>
                `;
                list.appendChild(li);
            });
        } else {
            list.innerHTML = `<li>אין חיבורים נוספים להצגה.</li>`;
        }
    } else {
        // Try calculating on the fly for the verse text
        const rawGematria = calculateGematria(insight.verseText);
        if (rawGematria > 0) {
            gemBox.style.display = 'block';
            document.getElementById('reader-gematria-val').innerText = rawGematria + ` (${numberToHebrew(rawGematria)})`;
            document.getElementById('reader-gematria-explain').innerText = `ערך גימטרי מחושב ישירות לפסוק זה. תוכל לחפש מקבילות במחשבון הגימטריה!`;
            document.getElementById('reader-gematria-list').innerHTML = "";
        } else {
            gemBox.style.display = 'none';
        }
    }

    // Bookmark & Upvote stats update
    updateReaderButtons();
    renderComments();

    // Admin Actions Bar inside Reader View
    const adminBar = document.querySelector('.admin-actions-bar');
    if (adminBar) {
        if (State.userRole === 'admin') {
            adminBar.style.display = 'flex';
            
            // Wire buttons
            const editBtn = document.getElementById('reader-admin-edit');
            const splitBtn = document.getElementById('reader-admin-split');
            const deleteBtn = document.getElementById('reader-admin-delete');
            
            // Remove previous event listeners by cloning
            const newEditBtn = editBtn.cloneNode(true);
            const newSplitBtn = splitBtn.cloneNode(true);
            const newDeleteBtn = deleteBtn.cloneNode(true);
            
            editBtn.parentNode.replaceChild(newEditBtn, editBtn);
            splitBtn.parentNode.replaceChild(newSplitBtn, splitBtn);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            
            newEditBtn.addEventListener('click', () => openAdvancedEditModal(insight.id));
            newSplitBtn.addEventListener('click', () => openSplitCommentaryModal(insight.id));
            newDeleteBtn.addEventListener('click', () => {
                if (deleteCommentary(insight.id)) {
                    switchView('study-hall-view');
                    document.querySelectorAll('.nav-link').forEach(link => {
                        if (link.getAttribute('data-target') === 'study-hall-view') {
                            link.classList.add('active');
                        } else {
                            link.classList.remove('active');
                        }
                    });
                }
            });
        } else {
            adminBar.style.display = 'none';
        }
    }
}

function populateInlineCommentaries(insight) {
    const genSection = document.getElementById('reader-general-section');
    const txtBox = document.getElementById('reader-general-text');
    if (!genSection || !txtBox) return;

    let html = "";
    
    // Add Pardes commentaries sequentially if they exist
    if (insight.interpretations) {
        if (insight.interpretations.peshat) {
            html += `
                <div class="pardes-section-block">
                    <div class="pardes-section-title"><span class="pardes-letter">פ</span>שט</div>
                    <div class="pardes-section-content">
                        ${insight.interpretations.peshat.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `;
        }
        if (insight.interpretations.remez) {
            html += `
                <div class="pardes-section-block">
                    <div class="pardes-section-title"><span class="pardes-letter">ר</span>מז</div>
                    <div class="pardes-section-content">
                        ${insight.interpretations.remez.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `;
        }
        if (insight.interpretations.derash) {
            html += `
                <div class="pardes-section-block">
                    <div class="pardes-section-title"><span class="pardes-letter">ד</span>רש</div>
                    <div class="pardes-section-content">
                        ${insight.interpretations.derash.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `;
        }
        if (insight.interpretations.sod) {
            html += `
                <div class="pardes-section-block">
                    <div class="pardes-section-title"><span class="pardes-letter">ס</span>וד</div>
                    <div class="pardes-section-content">
                        ${insight.interpretations.sod.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `;
        }
    }

    // Add general insights if they exist
    if (insight.generalInsights) {
        html += `
            <div class="pardes-section-block general-insight-block">
                <div class="pardes-section-title">פשט דרש ורמז</div>
                <div class="pardes-section-content">
                    ${insight.generalInsights.split('\n').map(p => `<p>${p}</p>`).join('')}
                </div>
            </div>
        `;
    }

    if (html) {
        genSection.style.display = 'block';
        txtBox.innerHTML = html;
    } else {
        genSection.style.display = 'none';
        txtBox.innerHTML = '';
    }

    // Add Toda Hashem section if it exists
    const todaSection = document.getElementById('reader-toda-section');
    const todaTxtBox = document.getElementById('reader-toda-text');
    if (todaSection && todaTxtBox) {
        if (insight.todaHashem && Array.isArray(insight.todaHashem) && insight.todaHashem.length > 0) {
            todaSection.style.display = 'block';
            todaTxtBox.innerHTML = insight.todaHashem.map(subItem => `
                <div class="pardes-section-block toda-hashem-block" style="border-right-color: var(--accent-gold); margin-bottom: 1rem;">
                    <div class="pardes-section-title">${subItem.title}</div>
                    <div class="pardes-section-content">
                        ${subItem.content.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `).join('');
        } else if (insight.todaHashem && typeof insight.todaHashem === 'string' && insight.todaHashem.length > 0) {
            todaSection.style.display = 'block';
            todaTxtBox.innerHTML = `
                <div class="pardes-section-block toda-hashem-block" style="border-right-color: var(--accent-gold);">
                    <div class="pardes-section-title">תודה ה'</div>
                    <div class="pardes-section-content">
                        ${insight.todaHashem.split('\n').map(p => `<p>${p}</p>`).join('')}
                    </div>
                </div>
            `;
        } else {
            todaSection.style.display = 'none';
            todaTxtBox.innerHTML = '';
        }
    }
}

function applyReaderFontSize() {
    const elements = [
        document.getElementById('reader-verse-text'),
        document.getElementById('reader-general-text'),
        document.getElementById('reader-toda-text')
    ];
    elements.forEach(el => {
        if (el) {
            el.style.fontSize = `${State.fontSize}px`;
            // Verses should be slightly larger
            if (el.id === 'reader-verse-text') {
                el.style.fontSize = `${State.fontSize + 4}px`;
            }
        }
    });
}

function initFontSizeControls() {
    document.getElementById('font-increase').addEventListener('click', () => {
        if (State.fontSize < 32) {
            State.fontSize += 2;
            applyReaderFontSize();
        }
    });

    document.getElementById('font-decrease').addEventListener('click', () => {
        if (State.fontSize > 12) {
            State.fontSize -= 2;
            applyReaderFontSize();
        }
    });
}

function updateReaderButtons() {
    const id = State.selectedInsightId;
    const upvotesCount = State.upvotes[id] || 0;
    document.getElementById('reader-upvotes-count').innerText = upvotesCount;

    const bookmarkBtn = document.getElementById('reader-bookmark-btn');
    if (State.bookmarks.includes(id)) {
        bookmarkBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i> שמור בספרייה';
        bookmarkBtn.style.color = 'var(--accent-gold)';
        bookmarkBtn.style.borderColor = 'var(--accent-gold)';
    } else {
        bookmarkBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i> שמור בספרייה שלי';
        bookmarkBtn.style.color = 'var(--text-primary)';
        bookmarkBtn.style.borderColor = 'var(--border-color)';
    }
}

// Wire Bookmark & Upvote Events
function initReaderActions() {
    const upvoteBtn = document.getElementById('reader-upvote-btn');
    upvoteBtn.addEventListener('click', () => {
        const id = State.selectedInsightId;
        if (!State.upvotes[id]) State.upvotes[id] = 0;
        
        State.upvotes[id]++;
        saveLocalStorage('torah_upvotes', State.upvotes);
        updateReaderButtons();
        
        // Success animation effect (sparkles)
        upvoteBtn.style.transform = 'scale(1.1)';
        setTimeout(() => upvoteBtn.style.transform = 'scale(1)', 200);
    });

    const bookmarkBtn = document.getElementById('reader-bookmark-btn');
    bookmarkBtn.addEventListener('click', () => {
        const id = State.selectedInsightId;
        const idx = State.bookmarks.indexOf(id);
        
        if (idx === -1) {
            State.bookmarks.push(id);
        } else {
            State.bookmarks.splice(idx, 1);
        }
        
        saveLocalStorage('torah_bookmarks', State.bookmarks);
        updateReaderButtons();
    });

    // Add Comment
    document.getElementById('submit-comment').addEventListener('click', () => {
        const id = State.selectedInsightId;
        const nameInput = document.getElementById('comment-name');
        const textInput = document.getElementById('comment-text');

        const name = nameInput.value.trim() || "לומד תורה";
        const text = textInput.value.trim();

        if (!text) return;

        if (!State.comments[id]) State.comments[id] = [];
        
        const timestamp = new Date().toLocaleDateString('he-IL');
        State.comments[id].push({ name, text, date: timestamp });
        
        saveLocalStorage('torah_comments', State.comments);
        
        textInput.value = "";
        renderComments();
    });
}

function renderComments() {
    const id = State.selectedInsightId;
    const feed = document.getElementById('comments-feed');
    feed.innerHTML = "";

    const list = State.comments[id] || [];
    if (list.length === 0) {
        feed.innerHTML = `<div style="font-style: italic; font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-top: 1rem;">אין עדיין הערות לחידוש זה. היה הראשון להאיר!</div>`;
        return;
    }

    list.forEach(c => {
        const bubble = document.createElement('div');
        bubble.className = 'comment-bubble';
        bubble.innerHTML = `
            <div class="comment-bubble-header">
                <span>${c.name}</span>
                <span>${c.date}</span>
            </div>
            <div class="comment-bubble-text">${c.text}</div>
        `;
        feed.appendChild(bubble);
    });
    
    // Auto scroll comment feed to bottom
    feed.scrollTop = feed.scrollHeight;
}

// --- View 3: Scribe Desk (Editor) ---
function initScribeDesk() {
    const previewBtn = document.getElementById('preview-btn');
    const publishBtn = document.getElementById('publish-btn');
    const previewPanel = document.getElementById('preview-panel');
    const verseInput = document.getElementById('edit-verse');
    const vocalizedSpan = document.getElementById('editor-verse-vocalized');

    // Auto-fetch Tanakh verse with Nikud on blur
    verseInput.addEventListener('blur', () => {
        const val = verseInput.value.trim();
        if (!val) {
            vocalizedSpan.innerText = "";
            return;
        }
        
        vocalizedSpan.innerText = "טוען פסוק מנוקד מהאינטרנט...";
        const autoBox = document.getElementById('scribe-auto-analysis-box');
        if (autoBox) autoBox.style.display = 'none';
        
        fetchTanakhVerse(val).then(vocalized => {
            if (vocalized) {
                vocalizedSpan.innerHTML = vocalized;
                // Save it in the dataset for later use
                verseInput.dataset.vocalized = vocalized;
                
                // Run auto analysis on the fetched text
                runAutoAnalysis(vocalized, 'scribe-auto-analysis-box');
            } else {
                vocalizedSpan.innerText = "לא נמצא פסוק תואם. הקלד למשל: דברים ג, כג";
                delete verseInput.dataset.vocalized;
            }
        }).catch(err => {
            vocalizedSpan.innerText = "שגיאה בחיבור לשרת Sefaria API.";
            delete verseInput.dataset.vocalized;
        });
    });

    previewBtn.addEventListener('click', () => {
        const title = document.getElementById('edit-title').value.trim() || "חידוש תורה חדש";
        const category = document.getElementById('edit-category').value;
        const verse = document.getElementById('edit-verse').value.trim() || "דברים";
        const vocalized = verseInput.dataset.vocalized || "";
        const author = document.getElementById('edit-author').value.trim() || "פלוני אלמוני";
        const content = document.getElementById('edit-content').value.trim() || "הסופר טרם הזין תוכן לחידוש זה...";

        document.getElementById('preview-book-title').innerText = title;
        document.getElementById('preview-book-category').innerText = category;
        document.getElementById('preview-book-author').innerText = author;
        
        const previewVerseText = vocalized ? `${vocalized} (${verse})` : verse;
        document.getElementById('preview-book-content').innerHTML = `
            <div style="font-weight: bold; border-bottom: 1px dashed var(--border-gold); padding-bottom: 0.5rem; margin-bottom: 1rem; text-align: center; font-size: 1.35rem;">
                ${previewVerseText}
            </div>
            <div style="white-space: pre-wrap;">${content}</div>
        `;

        previewPanel.classList.add('active');
    });

    publishBtn.addEventListener('click', () => {
        const title = document.getElementById('edit-title').value.trim();
        const category = document.getElementById('edit-category').value;
        const verse = document.getElementById('edit-verse').value.trim();
        const vocalized = verseInput.dataset.vocalized || verse;
        const author = document.getElementById('edit-author').value.trim() || "מחבר אורח";
        const content = document.getElementById('edit-content').value.trim();

        if (!title || !content || !verse) {
            alert("אנא מלא את שדות הכותרת, הפסוק ותוכן החידוש לפני הפרסום!");
            return;
        }

        if (State.userRole === 'admin') {
            const newId = `user_${Date.now()}`;
            const newInsight = {
                id: newId,
                verseNum: "",
                verseText: vocalized,
                category: category,
                author: author,
                parasha: verse, // Save reference in parasha
                interpretations: {
                    peshat: content,
                    remez: "",
                    derash: "",
                    sod: ""
                },
                gematria: null,
                generalInsights: ""
            };

            // Add to state and save
            State.userInsights.unshift(newInsight);
            State.insights.unshift(newInsight);
            saveLocalStorage('torah_user_insights', State.userInsights);

            alert("החידוש פורסם בהצלחה בהיכל החידושים!");
        } else {
            // Regular user submits pending request
            const newRequest = {
                id: `req_${Date.now()}`,
                title: title,
                category: category,
                verse: verse,
                verseText: vocalized,
                author: author,
                content: content,
                date: new Date().toLocaleDateString('he-IL'),
                status: 'pending' // pending, approved, rejected
            };
            
            State.pendingRequests.unshift(newRequest);
            saveLocalStorage('torah_pending_requests', State.pendingRequests);
            
            alert("הצעת החידוש נשלחה בהצלחה לאישור מנהל המערכת!");
        }
        
        // Reset fields
        document.getElementById('edit-title').value = "";
        document.getElementById('edit-verse').value = "";
        document.getElementById('edit-content').value = "";
        vocalizedSpan.innerText = "";
        delete verseInput.dataset.vocalized;
        previewPanel.classList.remove('active');

        // Go to feed
        renderInsightsGrid();
        switchView('study-hall-view');
        
        // Highlight active navbar tab
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('data-target') === 'study-hall-view') {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    });
}

// --- View 4: Gematria Calculator ---
let gematriaSyncTimeout = null;
function saveGematriaQueryToServer(val) {
    clearTimeout(gematriaSyncTimeout);
    gematriaSyncTimeout = setTimeout(() => {
        saveLocalStorage('torah_gematria_query', val);
    }, 500);
}

function initGematriaCalculator() {
    const calcInput = document.getElementById('calc-input');
    const resultBox = document.getElementById('calc-result-box');
    const resultNum = document.getElementById('calc-result-num');
    const resultHeb = document.getElementById('calc-result-heb');
    const matchesSection = document.getElementById('calc-matches-section');
    const matchesGrid = document.getElementById('calc-matches-grid');
    const wordsAnalysis = document.getElementById('gematria-words-analysis');
    const wordsList = document.getElementById('gematria-words-list');

    // Close button for word detail
    const detailClose = document.getElementById('calc-word-detail-close');
    if (detailClose) {
        detailClose.addEventListener('click', () => {
            const detailSection = document.getElementById('calc-word-detail-section');
            if (detailSection) detailSection.style.display = 'none';
        });
    }

    calcInput.addEventListener('input', () => {
        const val = calcInput.value.trim();
        saveGematriaQueryToServer(val);

        // Sync shared verse
        State.sharedVerse = val;
        localStorage.setItem('torah_shared_verse', val);

        if (!val) {
            resultBox.style.display = 'none';
            matchesSection.style.display = 'none';
            wordsAnalysis.style.display = 'none';
            const detailSection = document.getElementById('calc-word-detail-section');
            if (detailSection) detailSection.style.display = 'none';
            return;
        }

        // Add to history after typing stops
        clearTimeout(calcInput._historyTimeout);
        calcInput._historyTimeout = setTimeout(() => {
            addToHistory('gematria', val);
        }, 1000);

        const score = calculateGematria(val);
        if (score === 0) {
            resultBox.style.display = 'none';
            matchesSection.style.display = 'none';
            wordsAnalysis.style.display = 'none';
            return;
        }

        // Show result
        resultBox.style.display = 'flex';
        resultNum.innerText = score;
        resultHeb.innerText = `בגימטריה: ${numberToHebrew(score)}`;

        // Word-by-word Gematria analysis
        const cleanText = stripNikud(val).replace(/[^א-ת\s]/g, "").replace(/\s+/g, " ").trim();
        if (cleanText) {
            wordsAnalysis.style.display = 'block';
            wordsList.innerHTML = "";
            const words = cleanText.split(' ');
            words.forEach(word => {
                if (!word) return;
                const scoreWord = calculateGematria(word);
                // Count how many verses in Tanakh have this exact Gematria score
                const matchCount = State.tanakhVerses.filter(v => v.gematria === scoreWord).length;

                // Check if word's gematria digits are a subset of the total score's digits
                const totalDigits = new Set(String(score).split(''));
                const wordDigits = String(scoreWord).split('');
                const isDigitSubset = scoreWord > 0 && wordDigits.every(d => totalDigits.has(d));

                const span = document.createElement('span');
                span.style.cursor = 'pointer';
                span.style.padding = '0.3rem 0.6rem';
                span.style.border = '1px solid var(--border-gold)';
                span.style.borderRadius = 'var(--border-radius-sm)';
                span.style.transition = 'all 0.2s';
                span.style.fontSize = '1.05rem';
                span.style.position = 'relative';

                if (isDigitSubset) {
                    span.style.background = 'rgba(var(--accent-gold-rgb), 0.18)';
                    span.style.borderColor = 'var(--accent-gold)';
                    span.style.boxShadow = '0 0 6px rgba(var(--accent-gold-rgb), 0.35)';
                    span.title = `ספרות ${scoreWord} כלולות בספרות ${score}`;
                } else {
                    span.style.background = 'var(--bg-secondary)';
                }

                const highlightBadge = isDigitSubset
                    ? ` <span style="font-size:0.75rem; background: var(--accent-gold); color: #1a1a2e; border-radius: 4px; padding: 0.05rem 0.3rem; font-weight: bold; vertical-align: middle;">✦</span>`
                    : '';
                span.innerHTML = `${word} = ${scoreWord}${highlightBadge} <span style="color: var(--accent-gold); font-weight: bold;">(${matchCount})</span>`;

                span.addEventListener('mouseenter', () => {
                    span.style.background = 'rgba(var(--accent-gold-rgb), 0.2)';
                    span.style.borderColor = 'var(--accent-gold)';
                });
                span.addEventListener('mouseleave', () => {
                    span.style.background = isDigitSubset ? 'rgba(var(--accent-gold-rgb), 0.18)' : 'var(--bg-secondary)';
                    span.style.borderColor = isDigitSubset ? 'var(--accent-gold)' : 'var(--border-gold)';
                });

                span.addEventListener('click', () => {
                    const detailSection = document.getElementById('calc-word-detail-section');
                    const detailWord = document.getElementById('calc-word-detail-word');
                    const detailScore = document.getElementById('calc-word-detail-score');
                    const detailHeb = document.getElementById('calc-word-detail-heb');
                    const detailGrid = document.getElementById('calc-word-detail-grid');
                    
                    if (detailSection && detailWord && detailScore && detailHeb && detailGrid) {
                        detailWord.innerText = word;
                        detailScore.innerText = scoreWord;
                        detailHeb.innerText = `בגימטריה: ${numberToHebrew(scoreWord)}`;
                        
                        // Find matches in Tanakh
                        const matches = State.tanakhVerses.filter(v => v.gematria === scoreWord);
                        detailGrid.innerHTML = "";
                        
                        if (matches.length > 0) {
                            const topBar = document.createElement('div');
                            topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.5rem;';

                            const limit = 50;
                            const note = document.createElement('div');
                            note.style.color = 'var(--accent-gold)';
                            note.style.fontWeight = 'bold';
                            note.style.fontSize = '1.05rem';
                            note.innerText = matches.length > limit ? `נמצאו ${matches.length} פסוקים בגימטריה זו (מציג ${limit}):` : `נמצאו ${matches.length} פסוקים:`;
                            topBar.appendChild(note);

                            const copyBtn = document.createElement('button');
                            copyBtn.type = 'button';
                            copyBtn.className = 'category-tab';
                            copyBtn.style.cssText = 'padding: 0.25rem 0.65rem; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
                            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק פסוקים';
                            copyBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const plainLines = matches.map(m => `${m.originalText} (${m.bookHeb} פרק ${numberToHebrew(m.chapter)} פסוק ${numberToHebrew(m.verse)})`);
                                window.copyPlainText(plainLines.join('\n'), copyBtn);
                            });
                            topBar.appendChild(copyBtn);
                            detailGrid.appendChild(topBar);

                            const displayMatches = matches.slice(0, limit);
                            
                            displayMatches.forEach(match => {
                                const insightMatch = findInsightByCoordinate(match.bookHeb, match.chapter, match.verse);
                                const item = document.createElement('div');
                                item.className = 'gematria-repetition-item';
                                item.style.cursor = 'pointer';
                                item.style.padding = '0.5rem 0';
                                item.style.borderBottom = '1px solid var(--border-color)';
                                item.style.transition = 'color 0.2s';
                                
                                item.addEventListener('mouseenter', () => { item.style.color = 'var(--accent-gold)'; });
                                item.addEventListener('mouseleave', () => { item.style.color = ''; });
                                
                                if (insightMatch) {
                                    item.addEventListener('click', () => {
                                        openInsightReader(insightMatch.id);
                                        switchView('insight-reader-view');
                                    });
                                } else {
                                    item.addEventListener('click', () => {
                                        document.getElementById('edit-verse').value = `${match.bookHeb} ${match.chapter}, ${match.verse}`;
                                        document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                                        switchView('scribe-desk-view');
                                        document.querySelectorAll('.nav-link').forEach(link => {
                                            if (link.getAttribute('data-target') === 'scribe-desk-view') {
                                                link.classList.add('active');
                                            } else {
                                                link.classList.remove('active');
                                            }
                                        });
                                    });
                                }
                                const sourceLabel = `(${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)})`;
                                item.innerHTML = `${match.originalText}<span style="color: var(--accent-gold); font-size: 1.0rem; font-family: var(--font-sans); margin-right: 0.25rem;">${sourceLabel}</span>`;
                                detailGrid.appendChild(item);
                            });
                        } else {
                            detailGrid.innerHTML = `
                                <div class="empty-state" style="padding: 2rem 0;">
                                    <p>לא נמצאו פסוקים במאגר בעלי גימטריה זהה ל-${scoreWord}.</p>
                                </div>
                            `;
                        }
                        
                        detailSection.style.display = 'block';
                        detailSection.scrollIntoView({ behavior: 'smooth' });
                    }
                });

                wordsList.appendChild(span);
            });
        } else {
            wordsAnalysis.style.display = 'none';
        }

        // Scan the entire Tanakh for matches
        const matches = State.tanakhVerses.filter(v => v.gematria === score);

        // Render matches
        matchesGrid.innerHTML = "";
        if (matches.length > 0) {
            matchesSection.style.display = 'block';
            
            const topBar = document.createElement('div');
            topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.5rem;';

            const limit = 50;
            const note = document.createElement('div');
            note.style.color = 'var(--accent-gold)';
            note.style.fontWeight = 'bold';
            note.style.fontSize = '1.05rem';
            note.innerText = matches.length > limit ? `נמצאו ${matches.length} פסוקים בגימטריה זו (מציג ${limit}):` : `נמצאו ${matches.length} פסוקים:`;
            topBar.appendChild(note);

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'category-tab';
            copyBtn.style.cssText = 'padding: 0.25rem 0.65rem; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק פסוקים';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const plainLines = matches.map(m => `${m.originalText} (${m.bookHeb} פרק ${numberToHebrew(m.chapter)} פסוק ${numberToHebrew(m.verse)})`);
                window.copyPlainText(plainLines.join('\n'), copyBtn);
            });
            topBar.appendChild(copyBtn);
            matchesGrid.appendChild(topBar);

            const displayMatches = matches.slice(0, limit);

            displayMatches.forEach(match => {
                const insightMatch = findInsightByCoordinate(match.bookHeb, match.chapter, match.verse);
                
                const item = document.createElement('div');
                item.className = 'gematria-repetition-item';
                item.style.cursor = 'pointer';
                item.style.padding = '0.5rem 0';
                item.style.borderBottom = '1px solid var(--border-color)';
                item.style.transition = 'color 0.2s';
                
                item.addEventListener('mouseenter', () => { item.style.color = 'var(--accent-gold)'; });
                item.addEventListener('mouseleave', () => { item.style.color = ''; });
                
                if (insightMatch) {
                    item.addEventListener('click', () => {
                        openInsightReader(insightMatch.id);
                        switchView('insight-reader-view');
                    });
                } else {
                    item.addEventListener('click', () => {
                        document.getElementById('edit-verse').value = `${match.bookHeb} ${match.chapter}, ${match.verse}`;
                        document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                        switchView('scribe-desk-view');
                        
                        document.querySelectorAll('.nav-link').forEach(link => {
                            if (link.getAttribute('data-target') === 'scribe-desk-view') {
                                link.classList.add('active');
                            } else {
                                link.classList.remove('active');
                            }
                        });
                    });
                }
                
                const sourceLabel = `(${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)})`;
                item.innerHTML = `${match.originalText}<span style="color: var(--accent-gold); font-size: 1rem; font-family: var(--font-sans); margin-right: 0.25rem;">${sourceLabel}</span>`;
                matchesGrid.appendChild(item);
            });
        } else {
            matchesGrid.innerHTML = `
                <div class="empty-state" style="padding: 2rem 0;">
                    <p>לא נמצאו פסוקים במאגר בעלי גימטריה זהה ל-${score}.</p>
                </div>
            `;
            matchesSection.style.display = 'block';
        }
    });
}

// --- Helper: Strip Nikud (Vocalisation) and Cantillation Marks ---
function stripNikud(text) {
    if (!text) return "";
    return text.replace(/[\u0591-\u05C7]/g, "");
}

// --- View 5: Word Repetition (Concordance) ---
function initWordRepetitionCalculator() {
    const searchInput = document.getElementById('word-search-input');
    const matchesSection = document.getElementById('word-matches-section');
    const matchesGrid = document.getElementById('word-matches-grid');
    const matchesCount = document.getElementById('word-matches-count');

    const verseInput = document.getElementById('verse-analysis-input');
    const analysisResults = document.getElementById('verse-analysis-results');
    const wordsList = document.getElementById('words-analysis-list');
    const pairsList = document.getElementById('pairs-analysis-list');

    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        const query = stripNikud(searchInput.value.trim());
        if (!query) {
            matchesSection.style.display = 'none';
            return;
        }

        const cleanQuery = query.replace(/[^א-ת\s]/g, "");
        if (!cleanQuery) {
            matchesSection.style.display = 'none';
            return;
        }

        // Search the entire Tanakh for exact word matches (preventing sub-word matches like matching חמישה for משה)
        const exactWordRegex = new RegExp('(^|[^א-ת])' + cleanQuery + '($|[^א-ת])');
        const matches = State.tanakhVerses.filter(v => exactWordRegex.test(v.cleanText));

        // Update count & query text display
        matchesCount.innerText = matches.length;
        const qDisp = document.getElementById('word-search-query-display');
        if (qDisp) qDisp.textContent = searchInput.value.trim();
        matchesSection.style.display = 'block';

        matchesGrid.innerHTML = "";

        // Store matches for frequency filter
        searchInput._lastMatches = matches;

        // Render matches
        matchesGrid.innerHTML = "";

        const limit = 50;
        const displayMatches = matches.slice(0, limit);

        if (matches.length > 0) {
            const topBar = document.createElement('div');
            topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.5rem;';

            const note = document.createElement('div');
            note.style.color = 'var(--accent-gold)';
            note.style.fontWeight = 'bold';
            note.style.fontSize = '1.05rem';
            note.innerText = matches.length > limit ? `נמצאו ${matches.length} תוצאות (מציג ${limit}):` : `נמצאו ${matches.length} תוצאות:`;
            topBar.appendChild(note);

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'category-tab';
            copyBtn.style.cssText = 'padding: 0.25rem 0.65rem; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק פסוקים';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const plainLines = matches.map(m => `${m.originalText} (${m.bookHeb} פרק ${numberToHebrew(m.chapter)} פסוק ${numberToHebrew(m.verse)})`);
                window.copyPlainText(plainLines.join('\n'), copyBtn);
            });
            topBar.appendChild(copyBtn);
            matchesGrid.appendChild(topBar);
        }

        if (displayMatches.length > 0) {
            displayMatches.forEach(match => {
                const insightMatch = findInsightByCoordinate(match.bookHeb, match.chapter, match.verse);
                
                const item = document.createElement('div');
                item.className = 'word-repetition-item';
                item.style.cursor = 'pointer';
                item.style.padding = '0.5rem 0';
                item.style.borderBottom = '1px solid var(--border-color)';
                item.style.transition = 'color 0.2s';
                
                item.addEventListener('mouseenter', () => { item.style.color = 'var(--accent-gold)'; });
                item.addEventListener('mouseleave', () => { item.style.color = ''; });
                
                if (insightMatch) {
                    item.addEventListener('click', () => {
                        openInsightReader(insightMatch.id);
                        switchView('insight-reader-view');
                    });
                } else {
                    item.addEventListener('click', () => {
                        document.getElementById('edit-verse').value = `${match.bookHeb} ${match.chapter}, ${match.verse}`;
                        document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                        switchView('scribe-desk-view');
                        
                        document.querySelectorAll('.nav-link').forEach(link => {
                            if (link.getAttribute('data-target') === 'scribe-desk-view') {
                                link.classList.add('active');
                            } else {
                                link.classList.remove('active');
                            }
                        });
                    });
                }
                
                const sourceLabel = `(${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)})`;
                item.innerHTML = `${match.originalText}<span style="color: var(--accent-gold); font-size: 1rem; font-family: var(--font-sans); margin-right: 0.25rem;">${sourceLabel}</span>`;
                matchesGrid.appendChild(item);
            });
        } else {
            matchesGrid.innerHTML = `
                <div class="empty-state" style="padding: 2rem 0;">
                    <p>לא נמצאו פסוקים.</p>
                </div>
            `;
        }
    });

    if (verseInput) {
        verseInput.addEventListener('input', () => {
            const val = verseInput.value.trim();
            
            // Sync shared verse
            State.sharedVerse = val;
            localStorage.setItem('torah_shared_verse', val);

            if (!val) {
                analysisResults.style.display = 'none';
                return;
            }

            // Add to history after typing stops
            clearTimeout(verseInput._historyTimeout);
            verseInput._historyTimeout = setTimeout(() => {
                addToHistory('wordRep', val);
            }, 1000);

            // Clean text: strip nikud and punctuation, keep letters and spaces
            const cleanText = stripNikud(val).replace(/[^א-ת\s]/g, "").replace(/\s+/g, " ").trim();
            if (!cleanText) {
                analysisResults.style.display = 'none';
                return;
            }

            const words = cleanText.split(' ');
            
            // Get elements for triplets and quads
            const tripletsList = document.getElementById('triplets-analysis-list');
            const quadsList = document.getElementById('quads-analysis-list');

            // 1. Word analysis
            wordsList.innerHTML = "";
            words.forEach(word => {
                if (!word) return;
                // Exact word match check
                const regex = new RegExp('(^|[^א-ת])' + word + '($|[^א-ת])');
                const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;

                const span = document.createElement('span');
                span.style.cursor = 'pointer';
                span.style.padding = '0.3rem 0.6rem';
                span.style.borderRadius = 'var(--border-radius-sm)';
                span.style.transition = 'all 0.2s';
                span.style.fontSize = '1.05rem';
                
                // Highlight bold if count is between 2 and 6 inclusive
                if (count >= 2 && count <= 6) {
                    span.style.background = '#ffe3e3';
                    span.style.border = '2px solid #ff8787';
                    span.style.fontWeight = '900';
                    span.style.color = '#c92a2a';
                } else {
                    span.style.background = 'var(--bg-secondary)';
                    span.style.border = '1px solid var(--border-gold)';
                }
                
                span.innerHTML = `${word} <span style="font-weight: bold;">(${count})</span>`;
                
                span.addEventListener('mouseenter', () => {
                    if (count >= 2 && count <= 6) {
                        span.style.background = '#ffc9c9';
                    } else {
                        span.style.background = 'rgba(var(--accent-gold-rgb), 0.1)';
                        span.style.borderColor = 'var(--accent-gold)';
                    }
                });
                span.addEventListener('mouseleave', () => {
                    if (count >= 2 && count <= 6) {
                        span.style.background = '#ffe3e3';
                    } else {
                        span.style.background = 'var(--bg-secondary)';
                        span.style.borderColor = 'var(--border-gold)';
                    }
                });
                
                span.addEventListener('click', () => {
                    searchInput.value = word;
                    searchInput.dispatchEvent(new Event('input'));
                    searchInput.scrollIntoView({ behavior: 'smooth' });
                    searchInput.focus();
                });

                wordsList.appendChild(span);
            });

            // 2. Pairs analysis
            pairsList.innerHTML = "";
            const pairs = [];
            for (let i = 0; i < words.length - 1; i++) {
                if (words[i] && words[i+1]) {
                    pairs.push(words[i] + " " + words[i+1]);
                }
            }

            if (pairs.length === 0) {
                pairsList.innerHTML = `<span style="color: var(--text-muted); font-size: 0.95rem;">אין מספיק מילים ליצירת צמדים.</span>`;
            } else {
                pairs.forEach(pair => {
                    const regex = new RegExp('(^|[^א-ת])' + pair + '($|[^א-ת])');
                    const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;

                    const span = document.createElement('span');
                    span.style.cursor = 'pointer';
                    span.style.padding = '0.3rem 0.6rem';
                    span.style.borderRadius = 'var(--border-radius-sm)';
                    span.style.transition = 'all 0.2s';
                    span.style.fontSize = '1.05rem';
                    
                    // Highlight bold if count is between 2 and 6 inclusive
                    if (count >= 2 && count <= 6) {
                        span.style.background = '#ffe3e3';
                        span.style.border = '2px solid #ff8787';
                        span.style.fontWeight = '900';
                        span.style.color = '#c92a2a';
                    } else {
                        span.style.background = 'var(--bg-secondary)';
                        span.style.border = '1px solid var(--border-gold)';
                    }
                    
                    span.innerHTML = `${pair} <span style="font-weight: bold;">(${count})</span>`;
                    
                    span.addEventListener('mouseenter', () => {
                        if (count >= 2 && count <= 6) {
                            span.style.background = '#ffc9c9';
                        } else {
                            span.style.background = 'rgba(var(--accent-gold-rgb), 0.1)';
                            span.style.borderColor = 'var(--accent-gold)';
                        }
                    });
                    span.addEventListener('mouseleave', () => {
                        if (count >= 2 && count <= 6) {
                            span.style.background = '#ffe3e3';
                        } else {
                            span.style.background = 'var(--bg-secondary)';
                            span.style.borderColor = 'var(--border-gold)';
                        }
                    });
                    
                    span.addEventListener('click', () => {
                        searchInput.value = pair;
                        searchInput.dispatchEvent(new Event('input'));
                        searchInput.scrollIntoView({ behavior: 'smooth' });
                        searchInput.focus();
                    });

                    pairsList.appendChild(span);
                });
            }

            // 3. Triplets analysis
            if (tripletsList) {
                tripletsList.innerHTML = "";
                const triplets = [];
                for (let i = 0; i < words.length - 2; i++) {
                    if (words[i] && words[i+1] && words[i+2]) {
                        triplets.push(words[i] + " " + words[i+1] + " " + words[i+2]);
                    }
                }

                if (triplets.length === 0) {
                    tripletsList.innerHTML = `<span style="color: var(--text-muted); font-size: 0.95rem;">אין מספיק מילים ליצירת שלשות.</span>`;
                } else {
                    triplets.forEach(triplet => {
                        const regex = new RegExp('(^|[^א-ת])' + triplet + '($|[^א-ת])');
                        const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;

                        const span = document.createElement('span');
                        span.style.cursor = 'pointer';
                        span.style.padding = '0.3rem 0.6rem';
                        span.style.borderRadius = 'var(--border-radius-sm)';
                        span.style.transition = 'all 0.2s';
                        span.style.fontSize = '1.05rem';
                        
                        // Highlight bold if count is between 2 and 6 inclusive
                        if (count >= 2 && count <= 6) {
                            span.style.background = '#ffe3e3';
                            span.style.border = '2px solid #ff8787';
                            span.style.fontWeight = '900';
                            span.style.color = '#c92a2a';
                        } else {
                            span.style.background = 'var(--bg-secondary)';
                            span.style.border = '1px solid var(--border-gold)';
                        }
                        
                        span.innerHTML = `${triplet} <span style="font-weight: bold;">(${count})</span>`;
                        
                        span.addEventListener('mouseenter', () => {
                            if (count >= 2 && count <= 6) {
                                span.style.background = '#ffc9c9';
                            } else {
                                span.style.background = 'rgba(var(--accent-gold-rgb), 0.1)';
                                span.style.borderColor = 'var(--accent-gold)';
                            }
                        });
                        span.addEventListener('mouseleave', () => {
                            if (count >= 2 && count <= 6) {
                                span.style.background = '#ffe3e3';
                            } else {
                                span.style.background = 'var(--bg-secondary)';
                                span.style.borderColor = 'var(--border-gold)';
                            }
                        });
                        
                        span.addEventListener('click', () => {
                            searchInput.value = triplet;
                            searchInput.dispatchEvent(new Event('input'));
                            searchInput.scrollIntoView({ behavior: 'smooth' });
                            searchInput.focus();
                        });

                        tripletsList.appendChild(span);
                    });
                }
            }

            // 4. Quads analysis
            if (quadsList) {
                quadsList.innerHTML = "";
                const quads = [];
                for (let i = 0; i < words.length - 3; i++) {
                    if (words[i] && words[i+1] && words[i+2] && words[i+3]) {
                        quads.push(words[i] + " " + words[i+1] + " " + words[i+2] + " " + words[i+3]);
                    }
                }

                if (quads.length === 0) {
                    quadsList.innerHTML = `<span style="color: var(--text-muted); font-size: 0.95rem;">אין מספיק מילים ליצירת רביעיות.</span>`;
                } else {
                    quads.forEach(quad => {
                        const regex = new RegExp('(^|[^א-ת])' + quad + '($|[^א-ת])');
                        const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;

                        const span = document.createElement('span');
                        span.style.cursor = 'pointer';
                        span.style.padding = '0.3rem 0.6rem';
                        span.style.borderRadius = 'var(--border-radius-sm)';
                        span.style.transition = 'all 0.2s';
                        span.style.fontSize = '1.05rem';
                        
                        // Highlight bold if count is between 2 and 6 inclusive
                        if (count >= 2 && count <= 6) {
                            span.style.background = '#ffe3e3';
                            span.style.border = '2px solid #ff8787';
                            span.style.fontWeight = '900';
                            span.style.color = '#c92a2a';
                        } else {
                            span.style.background = 'var(--bg-secondary)';
                            span.style.border = '1px solid var(--border-gold)';
                        }
                        
                        span.innerHTML = `${quad} <span style="font-weight: bold;">(${count})</span>`;
                        
                        span.addEventListener('mouseenter', () => {
                            if (count >= 2 && count <= 6) {
                                span.style.background = '#ffc9c9';
                            } else {
                                span.style.background = 'rgba(var(--accent-gold-rgb), 0.1)';
                                span.style.borderColor = 'var(--accent-gold)';
                            }
                        });
                        span.addEventListener('mouseleave', () => {
                            if (count >= 2 && count <= 6) {
                                span.style.background = '#ffe3e3';
                            } else {
                                span.style.background = 'var(--bg-secondary)';
                                span.style.borderColor = 'var(--border-gold)';
                            }
                        });
                        
                        span.addEventListener('click', () => {
                            searchInput.value = quad;
                            searchInput.dispatchEvent(new Event('input'));
                            searchInput.scrollIntoView({ behavior: 'smooth' });
                            searchInput.focus();
                        });

                        quadsList.appendChild(span);
                    });
                }
            }

            analysisResults.style.display = 'block';
        });
    }
}


function getCommentaryCounts() {
    const countsMap = {};
    for (let key in SefariaBookMap) {
        countsMap[key] = {};
    }
    State.insights.forEach(insight => {
        let parsedRef = parseHebrewReference(insight.verseText);
        if (!parsedRef) {
            const resolvedBook = resolveBookName(insight.parasha);
            if (resolvedBook) {
                parsedRef = {
                    bookHeb: resolvedBook,
                    chapter: insight.chapter || 1
                };
            } else if (insight.verseNum) {
                parsedRef = {
                    bookHeb: "דברים",
                    chapter: insight.chapter || 3
                };
            }
        }
        
        if (parsedRef && parsedRef.bookHeb && parsedRef.chapter) {
            const bookHeb = parsedRef.bookHeb;
            const chap = parsedRef.chapter;
            if (!countsMap[bookHeb]) countsMap[bookHeb] = {};
            if (!countsMap[bookHeb][chap]) countsMap[bookHeb][chap] = 0;
            countsMap[bookHeb][chap]++;
        }
    });
    return countsMap;
}

function filterStudyHallByChapter(bookHeb, chapterNum) {
    // Reset active category tab to 'all' so that search filtering works correctly for any book type
    const categoryTabs = document.querySelectorAll('.category-tab');
    categoryTabs.forEach(t => {
        if (t.getAttribute('data-category') === 'all') {
            t.classList.add('active');
        } else {
            t.classList.remove('active');
        }
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = `${bookHeb} פרק ${numberToHebrew(chapterNum)}`;
        renderInsightsGrid();
    }
    switchView('study-hall-view');
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('data-target') === 'study-hall-view') {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function renderCommentaryIndex() {
    const torahContainer = document.getElementById('index-category-torah');
    const neviimContainer = document.getElementById('index-category-neviim');
    const ketuvimContainer = document.getElementById('index-category-ketuvim');
    
    if (!torahContainer || !neviimContainer || !ketuvimContainer) return;
    
    // Clear previous elements
    torahContainer.innerHTML = "";
    neviimContainer.innerHTML = "";
    ketuvimContainer.innerHTML = "";

    if (typeof TanakhData === 'undefined') {
        const errMsg = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <p>לא נטען מסד הנתונים הלא מקוון של התנ"ך.</p>
            </div>
        `;
        torahContainer.innerHTML = errMsg;
        return;
    }

    const countsMap = getCommentaryCounts();

    const TanakhStructure = {
        "torah": ["Gen", "Exod", "Lev", "Num", "Deut"],
        "neviim": ["Josh", "Judg", "1Sam", "2Sam", "1Kgs", "2Kgs", "Isa", "Jer", "Ezek", "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal"],
        "ketuvim": ["Ps", "Prov", "Job", "Song", "Ruth", "Lam", "Eccl", "Esth", "Dan", "Ezra", "Neh", "1Chr", "2Chr"]
    };

    const RikarttToHebrewMap = {
        "Gen": { eng: "Genesis", heb: "בראשית" },
        "Exod": { eng: "Exodus", heb: "שמות" },
        "Lev": { eng: "Leviticus", heb: "ויקרא" },
        "Num": { eng: "Numbers", heb: "במדבר" },
        "Deut": { eng: "Deuteronomy", heb: "דברים" },
        "Josh": { eng: "Joshua", heb: "יהושע" },
        "Judg": { eng: "Judges", heb: "שופטים" },
        "1Sam": { eng: "I Samuel", heb: "שמואל א" },
        "2Sam": { eng: "II Samuel", heb: "שמואל ב" },
        "1Kgs": { eng: "I Kings", heb: "מלכים א" },
        "2Kgs": { eng: "II Kings", heb: "מלכים ב" },
        "Isa": { eng: "Isaiah", heb: "ישעיהו" },
        "Jer": { eng: "Jeremiah", heb: "ירמיהו" },
        "Ezek": { eng: "Ezekiel", heb: "יחזקאל" },
        "Hos": { eng: "Hosea", heb: "הושע" },
        "Joel": { eng: "Joel", heb: "יואל" },
        "Amos": { eng: "Amos", heb: "עמוס" },
        "Obad": { eng: "Obadiah", heb: "עובדיה" },
        "Jonah": { eng: "Jonah", heb: "יונה" },
        "Mic": { eng: "Micah", heb: "מיכה" },
        "Nah": { eng: "Nahum", heb: "נחום" },
        "Hab": { eng: "Habakkuk", heb: "חבקוק" },
        "Zeph": { eng: "Zephaniah", heb: "צפניה" },
        "Hag": { eng: "Haggai", heb: "חגי" },
        "Zech": { eng: "Zechariah", heb: "זכריה" },
        "Mal": { eng: "Malachi", heb: "מלאכי" },
        "Ps": { eng: "Psalms", heb: "תהילים" },
        "Prov": { eng: "Proverbs", heb: "משלי" },
        "Job": { eng: "Job", heb: "איוב" },
        "Song": { eng: "Song of Songs", heb: "שיר השירים" },
        "Ruth": { eng: "Ruth", heb: "רות" },
        "Lam": { eng: "Lamentations", heb: "איכה" },
        "Eccl": { eng: "Ecclesiastes", heb: "קהלת" },
        "Esth": { eng: "Esther", heb: "אסתר" },
        "Dan": { eng: "Daniel", heb: "דניאל" },
        "Ezra": { eng: "Ezra", heb: "עזרא" },
        "Neh": { eng: "Nehemiah", heb: "נחמיה" },
        "1Chr": { eng: "I Chronicles", heb: "דברי הימים א" },
        "2Chr": { eng: "II Chronicles", heb: "דברי הימים ב" }
    };

    // Helper to render book cards into a specific container
    function renderCategoryBooks(categoryKey, container) {
        const bookKeys = TanakhStructure[categoryKey];
        if (!bookKeys) return;
        
        bookKeys.forEach(rBook => {
            const bookInfo = RikarttToHebrewMap[rBook];
            if (!bookInfo) return;

            const bookHeb = bookInfo.heb;
            const bookData = TanakhData[rBook];
            if (!bookData) return;
            
            const numChapters = bookData.length;

            // Calculate total commentaries for this book
            let bookTotal = 0;
            const bookChaptersCounts = countsMap[bookHeb] || {};
            Object.values(bookChaptersCounts).forEach(c => bookTotal += c);

            const card = document.createElement('div');
            card.className = `index-book-card ${bookTotal === 0 ? 'zero-commentaries' : ''}`;
            
            card.innerHTML = `
                <div class="index-book-header">
                    <span class="index-book-title">${bookHeb}</span>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="index-book-count-badge ${bookTotal === 0 ? 'zero' : ''}">${bookTotal}</span>
                        <i class="fa-solid fa-chevron-down index-book-toggle-icon"></i>
                    </div>
                </div>
                <div class="index-book-content">
                    <div class="index-chapters-grid">
                        <!-- Chapters will be rendered here -->
                    </div>
                </div>
            `;

            // Toggle expansion
            const header = card.querySelector('.index-book-header');
            header.addEventListener('click', () => {
                card.classList.toggle('expanded');
            });

            // Render chapters
            const chapGrid = card.querySelector('.index-chapters-grid');
            for (let c = 1; c <= numChapters; c++) {
                const count = bookChaptersCounts[c] || 0;
                const btn = document.createElement('button');
                btn.className = `index-chapter-btn ${count > 0 ? 'has-commentaries' : ''}`;
                btn.title = `פרק ${numberToHebrew(c)} ${count > 0 ? `(${count} פירושים)` : '(אין פירושים)'}`;
                
                btn.innerHTML = `
                    <span class="chap-num-label">${numberToHebrew(c)}</span>
                    ${count > 0 ? `<span class="index-chapter-count">${count}</span>` : ''}
                `;

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (count > 0) {
                        filterStudyHallByChapter(bookHeb, c);
                    } else {
                        // Pre-fill Scribe Desk for writing a new commentary on this chapter
                        document.getElementById('edit-verse').value = `${bookHeb} ${c}, 1`;
                        document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                        switchView('scribe-desk-view');
                        
                        document.querySelectorAll('.nav-link').forEach(link => {
                            if (link.getAttribute('data-target') === 'scribe-desk-view') {
                                link.classList.add('active');
                            } else {
                                link.classList.remove('active');
                            }
                        });
                    }
                });

                chapGrid.appendChild(btn);
            }

            container.appendChild(card);
        });
    }

    renderCategoryBooks("torah", torahContainer);
    renderCategoryBooks("neviim", neviimContainer);
    renderCategoryBooks("ketuvim", ketuvimContainer);
}

// --- View 6: My Library (Bookmarks, Uploads, Stats) ---
function initLibraryView() {
    // Tab switching in Library
    const tabBtns = document.querySelectorAll('.library-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.activeLibraryTab = btn.getAttribute('data-lib');
            renderLibrary();
        });
    });

    // File Drag and Drop uploader setup
    const dropZone = document.getElementById('file-upload-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent-royal)';
        dropZone.style.backgroundColor = 'var(--bg-card)';
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.style.borderColor = 'var(--border-gold)';
            dropZone.style.backgroundColor = 'var(--bg-secondary)';
        });
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });
}

function handleFileUpload(file) {
    if (!file.name.endsWith('.txt')) {
        alert("אנא העלה קובצי טקסט (.txt) בלבד!");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        try {
            const parsed = parseTorahText(text);
            const prefix = `upload_${Date.now()}`;
            
            let count = 0;
            let loaded = [];
            
            let fileChapter = null;
            const rangeMatch = (parsed.versesRange || "").match(/פרק\s+([א-ת]+|\d+)/) || (parsed.subTitle || "").match(/פרק\s+([א-ת]+|\d+)/) || (parsed.title || "").match(/פרק\s+([א-ת]+|\d+)/);
            if (rangeMatch) {
                const chapStr = rangeMatch[1];
                fileChapter = isNaN(chapStr) ? calculateGematria(chapStr) : parseInt(chapStr);
            }

            parsed.insights.forEach((insight, idx) => {
                insight.id = `${prefix}_v_${insight.verseNum || idx}`;
                insight.author = "קובץ שהועלה";
                insight.parasha = parsed.title.replace("פרשת ", "") || "פרשה חיצונית";
                if (fileChapter) insight.chapter = fileChapter;
                loaded.push(insight);
                count++;
            });

            parsed.essays.forEach((essay, idx) => {
                if (essay.content.length > 50) {
                    loaded.push({
                        id: `${prefix}_e_${idx}`,
                        verseNum: "",
                        verseText: essay.title,
                        category: "חסידות ומחשבה",
                        author: "קובץ שהועלה",
                        parasha: parsed.title.replace("פרשת ", "") || "פרשה חיצונית",
                        interpretations: {
                            peshat: essay.content,
                            remez: "",
                            derash: "",
                            sod: ""
                        },
                        gematria: null,
                        generalInsights: ""
                    });
                    count++;
                }
            });

            if (count > 0) {
                State.uploadedInsights = [...loaded, ...State.uploadedInsights];
                State.insights = [...loaded, ...State.insights];
                saveLocalStorage('torah_uploaded_insights', State.uploadedInsights);
                alert(`פענוח הושלם בהצלחה! ${count} חידושים נטענו לבית המדרש.`);
                
                // Go to Study Hall to view them
                renderInsightsGrid();
                switchView('study-hall-view');
                
                // Highlight correct navigation link
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'study-hall-view') {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            } else {
                alert("לא נמצאו חידושים בפורמט מוכר בקובץ הנתון.");
            }
        } catch (err) {
            console.error(err);
            alert("שגיאה בפענוח קובץ הטקסט.");
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function renderLibrary() {
    const listContainer = document.getElementById('library-list');
    listContainer.innerHTML = "";

    let items = [];
    if (State.activeLibraryTab === 'bookmarks') {
        items = State.insights.filter(insight => State.bookmarks.includes(insight.id));
    } else if (State.activeLibraryTab === 'my-insights') {
        items = State.userInsights;
    } else if (State.activeLibraryTab === 'pending-requests') {
        items = State.pendingRequests;
    }

    // Update counts
    document.getElementById('lib-bookmarks-count').innerText = State.bookmarks.length;
    document.getElementById('lib-my-count').innerText = State.userInsights.length;
    const libPendingCount = document.getElementById('lib-pending-count');
    if (libPendingCount) {
        libPendingCount.innerText = State.pendingRequests.length;
    }

    if (items.length === 0) {
        const icon = State.activeLibraryTab === 'bookmarks' ? 'fa-book-bookmark' : (State.activeLibraryTab === 'pending-requests' ? 'fa-clipboard-question' : 'fa-feather');
        const msg = State.activeLibraryTab === 'bookmarks' ? 'אין פריטים שמורים בספרייה זו.' : (State.activeLibraryTab === 'pending-requests' ? 'אין הצעות פרסום ממתינות או מאושרות בספרייה זו.' : 'טרם כתבת חידושים משלך. עבור ל"השולחן שלי" כדי לכתוב!');
        listContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fa-solid ${icon}"></i></div>
                <p>${msg}</p>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'library-item';
        
        let titleText = "";
        let subText = "";
        let statusBadge = "";

        if (State.activeLibraryTab === 'pending-requests') {
            titleText = item.title || item.verseText || `הצעה לשיעור/מקור ${item.verse}`;
            subText = `פרק/פסוק: ${item.verse} | תאריך: ${item.date}`;
            
            let statusClass = "status-pending";
            let statusText = "ממתין לאישור";
            if (item.status === 'approved') {
                statusClass = "status-approved";
                statusText = "אושר ופורסם";
            } else if (item.status === 'rejected') {
                statusClass = "status-rejected";
                statusText = "נדחה";
            }
            statusBadge = `<span class="library-item-status ${statusClass}">${statusText}</span>`;
        } else {
            let vNumDisplay = item.verseNum;
            if (vNumDisplay && !isNaN(vNumDisplay)) vNumDisplay = numberToHebrew(parseInt(vNumDisplay));
            titleText = item.verseNum ? `ביאור לפסוק ${vNumDisplay} (${item.parasha})` : item.verseText;
            subText = item.verseNum ? item.verseText : `קטגוריה: ${item.category}`;
        }

        div.innerHTML = `
            <div class="library-item-info" ${State.activeLibraryTab !== 'pending-requests' ? `onclick="openInsightReader('${item.id}'); switchView('insight-reader-view');"` : ''}>
                <div class="library-item-title">${titleText}</div>
                <div class="library-item-meta">${subText}</div>
            </div>
            ${statusBadge}
            <button class="library-item-action-btn" title="${State.activeLibraryTab === 'bookmarks' ? 'הסר סימנייה' : (State.activeLibraryTab === 'pending-requests' ? 'מחק הצעה' : 'מחק חידוש')}">
                <i class="fa-solid ${State.activeLibraryTab === 'bookmarks' ? 'fa-bookmark-slash' : 'fa-trash-can'}"></i>
            </button>
        `;

        // Wire item actions (Remove bookmark / delete written insight / cancel request)
        const actionBtn = div.querySelector('.library-item-action-btn');
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (State.activeLibraryTab === 'bookmarks') {
                const bIdx = State.bookmarks.indexOf(item.id);
                if (bIdx > -1) {
                    State.bookmarks.splice(bIdx, 1);
                    saveLocalStorage('torah_bookmarks', State.bookmarks);
                }
            } else if (State.activeLibraryTab === 'pending-requests') {
                if (confirm("האם אתה בטוח שברצונך למחוק הצעה זו?")) {
                    const rIdx = State.pendingRequests.findIndex(req => req.id === item.id);
                    if (rIdx > -1) {
                        State.pendingRequests.splice(rIdx, 1);
                        saveLocalStorage('torah_pending_requests', State.pendingRequests);
                    }
                }
            } else {
                if (confirm("האם אתה בטוח שברצונך למחוק חידוש זה?")) {
                    const uIdx = State.userInsights.findIndex(insight => insight.id === item.id);
                    if (uIdx > -1) {
                        State.userInsights.splice(uIdx, 1);
                        saveLocalStorage('torah_user_insights', State.userInsights);
                        
                        // Remove from active insights list
                        const iIdx = State.insights.findIndex(insight => insight.id === item.id);
                        if (iIdx > -1) State.insights.splice(iIdx, 1);
                    }
                }
            }
            renderLibrary();
            updateStats();
        });

        listContainer.appendChild(div);
    });
}

function openAdvancedEditModal(id) {
    let insight;
    if (id.startsWith('req_')) {
        insight = State.pendingRequests.find(item => item.id === id);
    } else {
        insight = State.insights.find(item => item.id === id);
    }
    if (!insight) return;
    
    document.getElementById('adv-edit-id').value = id;
    document.getElementById('adv-edit-title').value = insight.title || insight.verseText || "";
    document.getElementById('adv-edit-category').value = insight.category || "תורה";
    document.getElementById('adv-edit-parasha').value = insight.verse || insight.parasha || "";
    document.getElementById('adv-edit-chapter').value = insight.chapter || "";
    document.getElementById('adv-edit-verseNum').value = insight.verseNum || "";
    document.getElementById('adv-edit-author').value = insight.author || "";
    
    document.getElementById('adv-edit-peshat').value = insight.interpretations?.peshat || insight.content || "";
    document.getElementById('adv-edit-remez').value = insight.interpretations?.remez || "";
    document.getElementById('adv-edit-derash').value = insight.interpretations?.derash || "";
    document.getElementById('adv-edit-sod').value = insight.interpretations?.sod || "";
    
    document.getElementById('adv-edit-gem-val').value = insight.gematria?.value || "";
    document.getElementById('adv-edit-gem-explain').value = insight.gematria?.explanation || "";
    document.getElementById('adv-edit-gem-conns').value = JSON.stringify(insight.gematria?.connections || [], null, 2);
    document.getElementById('adv-edit-general').value = insight.generalInsights || "";
    
    document.getElementById('advanced-edit-modal').classList.add('active');
}

function openSplitCommentaryModal(id) {
    const insight = State.insights.find(item => item.id === id);
    if (!insight) return;
    
    document.getElementById('split-orig-id').value = id;
    document.getElementById('split-orig-text').value = insight.verseText || "";
    document.getElementById('split-orig-peshat').value = insight.interpretations?.peshat || "";
    document.getElementById('split-orig-remez').value = insight.interpretations?.remez || "";
    document.getElementById('split-orig-derash').value = insight.interpretations?.derash || "";
    document.getElementById('split-orig-sod').value = insight.interpretations?.sod || "";
    document.getElementById('split-orig-general').value = insight.generalInsights || "";
    
    const resolvedBook = resolveBookName(insight.parasha || insight.verseText) || "דברים";
    document.getElementById('split-orig-coord-label').innerText = `${insight.parasha || resolvedBook} פרק ${numberToHebrew(insight.chapter || 1)} פסוק ${insight.verseNum || "א"}`;
    
    // Clear split new form
    document.getElementById('split-new-book').value = resolvedBook;
    document.getElementById('split-new-chapter').value = insight.chapter || 1;
    document.getElementById('split-new-verseNum').value = insight.verseNum || "";
    document.getElementById('split-new-text').value = insight.verseText || "";
    document.getElementById('split-new-peshat').value = "";
    document.getElementById('split-new-remez').value = "";
    document.getElementById('split-new-derash').value = "";
    document.getElementById('split-new-sod').value = "";
    document.getElementById('split-new-general').value = "";
    
    document.getElementById('split-commentary-modal').classList.add('active');
}

function deleteCommentary(id) {
    if (!confirm("האם אתה בטוח שברצונך למחוק פירוש זה?")) {
        return false;
    }
    
    const userIdx = State.userInsights.findIndex(ins => ins.id === id);
    const uploadIdx = State.uploadedInsights.findIndex(ins => ins.id === id);
    
    if (userIdx > -1) {
        State.userInsights.splice(userIdx, 1);
        saveLocalStorage('torah_user_insights', State.userInsights);
    } else if (uploadIdx > -1) {
        State.uploadedInsights.splice(uploadIdx, 1);
        saveLocalStorage('torah_uploaded_insights', State.uploadedInsights);
    } else {
        // Default insight
        if (!State.deletedDefaultIds.includes(id)) {
            State.deletedDefaultIds.push(id);
            saveLocalStorage('torah_deleted_default_ids', State.deletedDefaultIds);
        }
    }
    
    loadDefaultData().then(() => {
        if (State.activeView === 'study-hall-view') {
            renderInsightsGrid();
        } else if (State.activeView === 'library-view') {
            renderLibrary();
        }
    });
    
    alert("הפירוש נמחק בהצלחה.");
    return true;
}

function renderAdminRequests() {
    const list = document.getElementById('admin-requests-list');
    if (!list) return;
    list.innerHTML = "";
    
    const pending = State.pendingRequests.filter(r => r.status === 'pending');
    if (pending.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fa-solid fa-clipboard-check"></i></div>
                <p>אין בקשות פרסום ממתינות לאישור.</p>
            </div>
        `;
        return;
    }
    
    pending.forEach(req => {
        const card = document.createElement('div');
        card.className = 'request-card';
        card.innerHTML = `
            <div class="request-card-header">
                <span class="card-category">${req.category}</span>
                <span class="card-date">${req.date} | מאת: ${req.author}</span>
            </div>
            <h3 class="request-card-title">${req.title}</h3>
            <div class="request-card-verse">${req.verseText || req.verse}</div>
            <div class="request-card-content">
                ${req.content || req.interpretations?.peshat || ""}
                ${req.interpretations?.remez ? `<br><b>רמז:</b> ${req.interpretations.remez}` : ""}
                ${req.interpretations?.derash ? `<br><b>דרש:</b> ${req.interpretations.derash}` : ""}
                ${req.interpretations?.sod ? `<br><b>סוד:</b> ${req.interpretations.sod}` : ""}
                ${req.generalInsights ? `<br><b>ביאור כללי:</b> ${req.generalInsights}` : ""}
            </div>
            <div class="request-card-meta">
                <div class="request-card-actions">
                    <button class="primary-btn approve-req-btn" data-id="${req.id}"><i class="fa-solid fa-check"></i> אשר פרסום</button>
                    <button class="secondary-btn edit-req-btn" data-id="${req.id}"><i class="fa-solid fa-pen-to-square"></i> ערוך הצעה</button>
                    <button class="secondary-btn reject-req-btn" style="color: #e53e3e; border-color: #e53e3e;" data-id="${req.id}"><i class="fa-solid fa-xmark"></i> דחה</button>
                </div>
            </div>
        `;
        
        // Wire buttons
        card.querySelector('.approve-req-btn').addEventListener('click', () => {
            approveRequest(req.id);
        });
        card.querySelector('.reject-req-btn').addEventListener('click', () => {
            rejectRequest(req.id);
        });
        card.querySelector('.edit-req-btn').addEventListener('click', () => {
            openAdvancedEditModal(req.id);
        });
        
        list.appendChild(card);
    });
}

function approveRequest(reqId) {
    const reqIdx = State.pendingRequests.findIndex(r => r.id === reqId);
    if (reqIdx === -1) return;
    const req = State.pendingRequests[reqIdx];
    
    const newId = `user_${Date.now()}`;
    const newInsight = {
        id: newId,
        verseNum: req.verseNum || "",
        verseText: req.verseText || req.title,
        category: req.category,
        author: req.author,
        parasha: req.verse || req.parasha || "כללי",
        chapter: req.chapter || null,
        interpretations: req.interpretations || {
            peshat: req.content,
            remez: "",
            derash: "",
            sod: ""
        },
        gematria: req.gematria || null,
        generalInsights: req.generalInsights || ""
    };
    
    State.userInsights.unshift(newInsight);
    saveLocalStorage('torah_user_insights', State.userInsights);
    
    req.status = 'approved';
    saveLocalStorage('torah_pending_requests', State.pendingRequests);
    
    loadDefaultData().then(() => {
        renderAdminRequests();
        renderAdminRequestsBadge();
    });
    
    alert("הבקשה אושרה ופורסמה בהצלחה!");
}

function rejectRequest(reqId) {
    const reqIdx = State.pendingRequests.findIndex(r => r.id === reqId);
    if (reqIdx === -1) return;
    State.pendingRequests[reqIdx].status = 'rejected';
    saveLocalStorage('torah_pending_requests', State.pendingRequests);
    
    renderAdminRequests();
    renderAdminRequestsBadge();
    alert("הבקשה נדחתה.");
}

function initAdminModals() {
    const editModal = document.getElementById('advanced-edit-modal');
    const editClose = document.getElementById('edit-modal-close');
    const editCancel = document.getElementById('edit-modal-cancel');
    const editForm = document.getElementById('advanced-edit-form');
    
    const closeEdit = () => editModal.classList.remove('active');
    
    if (editClose) editClose.addEventListener('click', closeEdit);
    if (editCancel) editCancel.addEventListener('click', closeEdit);
    
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('adv-edit-id').value;
            
            const category = document.getElementById('adv-edit-category').value;
            const title = document.getElementById('adv-edit-title').value.trim();
            const parasha = document.getElementById('adv-edit-parasha').value.trim();
            const chapter = parseInt(document.getElementById('adv-edit-chapter').value) || null;
            const verseNum = document.getElementById('adv-edit-verseNum').value.trim();
            const author = document.getElementById('adv-edit-author').value.trim();
            
            const peshat = document.getElementById('adv-edit-peshat').value.trim();
            const remez = document.getElementById('adv-edit-remez').value.trim();
            const derash = document.getElementById('adv-edit-derash').value.trim();
            const sod = document.getElementById('adv-edit-sod').value.trim();
            
            const gemVal = parseInt(document.getElementById('adv-edit-gem-val').value);
            const gemExplain = document.getElementById('adv-edit-gem-explain').value.trim();
            const gemConnsRaw = document.getElementById('adv-edit-gem-conns').value.trim();
            const general = document.getElementById('adv-edit-general').value.trim();
            
            let gemConns = [];
            if (gemConnsRaw) {
                try {
                    gemConns = JSON.parse(gemConnsRaw);
                    if (!Array.isArray(gemConns)) {
                        alert("שגיאה: שדה קשרים גימטריים חייב להיות מערך של אובייקטים.");
                        return;
                    }
                } catch (err) {
                    alert("שגיאה במבנה ה-JSON של קשרים גימטריים. ודא שהוא תקין.");
                    return;
                }
            }
            
            const updatedInsight = {
                id: id,
                verseNum: verseNum,
                verseText: title,
                category: category,
                author: author,
                parasha: parasha,
                chapter: chapter,
                interpretations: {
                    peshat: peshat,
                    remez: remez,
                    derash: derash,
                    sod: sod
                },
                gematria: null,
                generalInsights: general
            };
            
            if (!isNaN(gemVal) || gemExplain || gemConns.length > 0) {
                updatedInsight.gematria = {
                    value: isNaN(gemVal) ? calculateGematria(title) : gemVal,
                    explanation: gemExplain,
                    connections: gemConns
                };
            }
            
            const userIdx = State.userInsights.findIndex(ins => ins.id === id);
            const uploadIdx = State.uploadedInsights.findIndex(ins => ins.id === id);
            const reqIdx = State.pendingRequests.findIndex(ins => ins.id === id);
            
            if (userIdx > -1) {
                State.userInsights[userIdx] = updatedInsight;
                saveLocalStorage('torah_user_insights', State.userInsights);
            } else if (uploadIdx > -1) {
                State.uploadedInsights[uploadIdx] = updatedInsight;
                saveLocalStorage('torah_uploaded_insights', State.uploadedInsights);
            } else if (reqIdx > -1) {
                const origReq = State.pendingRequests[reqIdx];
                const updatedReq = {
                    ...origReq,
                    title: title,
                    category: category,
                    verse: parasha,
                    verseText: title,
                    author: author,
                    chapter: chapter,
                    verseNum: verseNum,
                    interpretations: updatedInsight.interpretations,
                    gematria: updatedInsight.gematria,
                    generalInsights: general,
                    content: peshat || general
                };
                State.pendingRequests[reqIdx] = updatedReq;
                saveLocalStorage('torah_pending_requests', State.pendingRequests);
                renderAdminRequests();
            } else {
                State.editedDefaultInsights[id] = updatedInsight;
                saveLocalStorage('torah_edited_default_insights', State.editedDefaultInsights);
            }
            
            loadDefaultData().then(() => {
                if (State.selectedInsightId === id && State.activeView === 'insight-reader-view') {
                    openInsightReader(id);
                }
            });
            
            closeEdit();
            alert("השינויים נשמרו בהצלחה.");
        });
    }
    
    const splitModal = document.getElementById('split-commentary-modal');
    const splitClose = document.getElementById('split-modal-close');
    const splitCancel = document.getElementById('split-modal-cancel');
    const splitSaveBtn = document.getElementById('split-save-btn');
    
    const closeSplit = () => splitModal.classList.remove('active');
    
    if (splitClose) splitClose.addEventListener('click', closeSplit);
    if (splitCancel) splitCancel.addEventListener('click', closeSplit);
    
    const btnAllRight = document.getElementById('split-move-all-right');
    const btnGenRight = document.getElementById('split-move-general-right');
    
    if (btnAllRight) {
        btnAllRight.addEventListener('click', () => {
            document.getElementById('split-new-peshat').value = document.getElementById('split-orig-peshat').value;
            document.getElementById('split-new-remez').value = document.getElementById('split-orig-remez').value;
            document.getElementById('split-new-derash').value = document.getElementById('split-orig-derash').value;
            document.getElementById('split-new-sod').value = document.getElementById('split-orig-sod').value;
            document.getElementById('split-new-general').value = document.getElementById('split-orig-general').value;
            
            document.getElementById('split-orig-peshat').value = "";
            document.getElementById('split-orig-remez').value = "";
            document.getElementById('split-orig-derash').value = "";
            document.getElementById('split-orig-sod').value = "";
            document.getElementById('split-orig-general').value = "";
        });
    }
    
    if (btnGenRight) {
        btnGenRight.addEventListener('click', () => {
            document.getElementById('split-new-general').value = document.getElementById('split-orig-general').value;
            document.getElementById('split-orig-general').value = "";
        });
    }
    
    if (splitSaveBtn) {
        splitSaveBtn.addEventListener('click', () => {
            const id = document.getElementById('split-orig-id').value;
            
            const newBook = document.getElementById('split-new-book').value.trim();
            const newChapter = parseInt(document.getElementById('split-new-chapter').value) || null;
            const newVerseNum = document.getElementById('split-new-verseNum').value.trim();
            const newText = document.getElementById('split-new-text').value.trim();
            
            if (!newBook || !newChapter || !newVerseNum || !newText) {
                alert("אנא מלא את פרטי המקור (ספר, פרק, פסוק) והפסוק/מקור החדש עבור הפירוש המפוצל!");
                return;
            }
            
            const origInsight = State.insights.find(ins => ins.id === id);
            if (!origInsight) return;
            
            const updatedOrigInsight = {
                ...origInsight,
                verseText: document.getElementById('split-orig-text').value.trim(),
                interpretations: {
                    peshat: document.getElementById('split-orig-peshat').value.trim(),
                    remez: document.getElementById('split-orig-remez').value.trim(),
                    derash: document.getElementById('split-orig-derash').value.trim(),
                    sod: document.getElementById('split-orig-sod').value.trim()
                },
                generalInsights: document.getElementById('split-orig-general').value.trim()
            };
            
            const newId = `user_${Date.now()}`;
            const newInsight = {
                id: newId,
                verseNum: newVerseNum,
                verseText: newText,
                category: origInsight.category,
                author: origInsight.author + " (פוצל)",
                parasha: newBook,
                chapter: newChapter,
                interpretations: {
                    peshat: document.getElementById('split-new-peshat').value.trim(),
                    remez: document.getElementById('split-new-remez').value.trim(),
                    derash: document.getElementById('split-new-derash').value.trim(),
                    sod: document.getElementById('split-new-sod').value.trim()
                },
                gematria: null,
                generalInsights: document.getElementById('split-new-general').value.trim()
            };
            
            const userIdx = State.userInsights.findIndex(ins => ins.id === id);
            const uploadIdx = State.uploadedInsights.findIndex(ins => ins.id === id);
            
            if (userIdx > -1) {
                State.userInsights[userIdx] = updatedOrigInsight;
            } else if (uploadIdx > -1) {
                State.uploadedInsights[uploadIdx] = updatedOrigInsight;
            } else {
                State.editedDefaultInsights[id] = updatedOrigInsight;
                saveLocalStorage('torah_edited_default_insights', State.editedDefaultInsights);
            }
            
            State.userInsights.unshift(newInsight);
            
            saveLocalStorage('torah_user_insights', State.userInsights);
            if (uploadIdx > -1) {
                saveLocalStorage('torah_uploaded_insights', State.uploadedInsights);
            }
            
            loadDefaultData().then(() => {
                if (State.selectedInsightId === id && State.activeView === 'insight-reader-view') {
                    openInsightReader(id);
                }
            });
            
            closeSplit();
            alert("הפירוש פוצל לשניים בהצלחה!");
        });
    }
}

// --- Diligence Stats & Streak Controller ---
function updateStats() {
    // Streak check (Mocked day update logic)
    document.getElementById('streak-num').innerText = State.userStreak;

    // Counts
    document.getElementById('stats-published').innerText = State.userInsights.length;
    document.getElementById('stats-bookmarked').innerText = State.bookmarks.length;
    
    // Sum comments written by user
    let userCommentsCount = 0;
    Object.values(State.comments).forEach(list => {
        // Count comments with name != "מערכת"
        list.forEach(c => {
            if (c.name !== "מערכת בית המדרש" && c.name !== "מערכת") {
                userCommentsCount++;
            }
        });
    });
    document.getElementById('stats-comments').innerText = userCommentsCount;

    // Sum upvotes received on user's own insights
    let userUpvotesCount = 0;
    State.userInsights.forEach(insight => {
        userUpvotesCount += (State.upvotes[insight.id] || 0);
    });
    document.getElementById('stats-upvotes').innerText = userUpvotesCount;

    // Library tab counts updates
    const bCount = document.getElementById('lib-bookmarks-count');
    if (bCount) bCount.innerText = State.bookmarks.length;
    const uCount = document.getElementById('lib-my-count');
    if (uCount) uCount.innerText = State.userInsights.length;
}

// --- App Initialization ---
window.addEventListener('DOMContentLoaded', () => {
    loadLocalStorage();
    applyRoleSettings(); // Apply initial role-based access styling
    initOfflineTanakh(); // Index offline TanakhData on load
    initNavigation();
    initFilterControls();
    initFontSizeControls();
    initReaderActions();
    initScribeDesk();
    initGematriaCalculator();
    initMultiVerseGematria();
    initWordRepetitionCalculator();
    initRasheiTeivot();
    initUnifiedAnalysis();
    initAnagramFinder();
    initLibraryView();
    initAdminModals(); // Initialize modal handlers for Admin
    initAdminVerseManagement(); // Initialize admin verse management selectors
    
    // Sync shared inputs and render initial histories
    syncSharedVerseAndRenderHistories(State.activeView);
    
    loadFromServer().then(() => {
        loadDefaultData();
    });
});

// --- Admin Verse Management ---
function initAdminVerseManagement() {
    const bookSelect = document.getElementById('av-book-select');
    const chapterSelect = document.getElementById('av-chapter-select');
    const loadBtn = document.getElementById('av-load-btn');
    const container = document.getElementById('admin-verse-container');

    if (!bookSelect || !chapterSelect || !loadBtn || !container) return;

    // Only populate once
    if (bookSelect.options.length <= 1 && typeof TanakhData !== 'undefined') {
        const bookOrder = [
            ["בראשית","Gen"],["שמות","Exod"],["ויקרא","Lev"],["במדבר","Num"],["דברים","Deut"],
            ["יהושע","Josh"],["שופטים","Judg"],["שמואל א","1Sam"],["שמואל ב","2Sam"],
            ["מלכים א","1Kgs"],["מלכים ב","2Kgs"],["ישעיהו","Isa"],["ירמיהו","Jer"],
            ["יחזקאל","Ezek"],["הושע","Hos"],["יואל","Joel"],["עמוס","Amos"],
            ["עובדיה","Obad"],["יונה","Jonah"],["מיכה","Mic"],["נחום","Nah"],
            ["חבקוק","Hab"],["צפניה","Zeph"],["חגי","Hag"],["זכריה","Zech"],["מלאכי","Mal"],
            ["תהילים","Ps"],["משלי","Prov"],["איוב","Job"],["שיר השירים","Song"],
            ["רות","Ruth"],["איכה","Lam"],["קהלת","Eccl"],["אסתר","Esth"],
            ["דניאל","Dan"],["עזרא","Ezra"],["נחמיה","Neh"],["דברי הימים א","1Chr"],["דברי הימים ב","2Chr"]
        ];
        bookOrder.forEach(([heb, rk]) => {
            if (TanakhData[rk]) {
                const opt = document.createElement('option');
                opt.value = rk;
                opt.textContent = heb;
                bookSelect.appendChild(opt);
            }
        });
    }

    // Remove old listeners by cloning
    const newBookSelect = bookSelect.cloneNode(true);
    bookSelect.parentNode.replaceChild(newBookSelect, bookSelect);
    const newChapterSelect = chapterSelect.cloneNode(true);
    chapterSelect.parentNode.replaceChild(newChapterSelect, chapterSelect);
    const newLoadBtn = loadBtn.cloneNode(true);
    loadBtn.parentNode.replaceChild(newLoadBtn, loadBtn);

    const bSel = document.getElementById('av-book-select');
    const cSel = document.getElementById('av-chapter-select');
    const lBtn = document.getElementById('av-load-btn');

    bSel.addEventListener('change', () => {
        const rk = bSel.value;
        cSel.innerHTML = '<option value="">-- \u05d1\u05d7\u05e8 \u05e4\u05e8\u05e7 --</option>';
        cSel.disabled = true;
        lBtn.disabled = true;
        if (rk && TanakhData[rk]) {
            const numChapters = TanakhData[rk].length;
            for (let c = 1; c <= numChapters; c++) {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = `\u05e4\u05e8\u05e7 ${numberToHebrew(c)}`;
                cSel.appendChild(opt);
            }
            cSel.disabled = false;
        }
    });

    cSel.addEventListener('change', () => {
        lBtn.disabled = !cSel.value;
    });

    lBtn.addEventListener('click', () => {
        renderAdminVerseList();
    });
}

function renderAdminVerseList() {
    const bSel = document.getElementById('av-book-select');
    const cSel = document.getElementById('av-chapter-select');
    const container = document.getElementById('admin-verse-container');
    if (!bSel || !cSel || !container) return;

    const rk = bSel.value;
    const chapterNum = parseInt(cSel.value);
    const bookHeb = bSel.options[bSel.selectedIndex].textContent;

    if (!rk || !chapterNum || !TanakhData[rk]) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">\u05d1\u05d7\u05e8 \u05e1\u05e4\u05e8 \u05d5\u05e4\u05e8\u05e7 \u05ea\u05d7\u05d9\u05dc\u05d4</p>';
        return;
    }

    const chapterData = TanakhData[rk][chapterNum - 1];
    if (!chapterData) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05e4\u05e1\u05d5\u05e7\u05d9\u05dd</p>';
        return;
    }

    container.innerHTML = '';

    chapterData.forEach((words, vIdx) => {
        const verseNum = vIdx + 1;
        const key = `${bookHeb}|${chapterNum}|${verseNum}`;
        const cleanWords = words.filter(w => w !== 'ס' && w !== 'פ');
        const currentText = State.editedVerses[key]
            ? State.editedVerses[key].originalText
            : cleanWords.join(' ');

        const row = document.createElement('div');
        row.style.cssText = 'background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;';

        const label = document.createElement('div');
        label.style.cssText = 'font-size: 0.9rem; color: var(--accent-gold); font-weight: bold; font-family: var(--font-sans);';
        label.textContent = `${bookHeb} ${numberToHebrew(chapterNum)}:${numberToHebrew(verseNum)}`;
        if (State.editedVerses[key]) {
            label.textContent += ' (\u05e2\u05e8\u05d5\u05da)';
        }

        const textarea = document.createElement('textarea');
        textarea.value = currentText;
        textarea.style.cssText = 'width: 100%; min-height: 60px; padding: 0.5rem; font-family: var(--font-serif); font-size: 1.1rem; direction: rtl; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); color: var(--text-primary); resize: vertical; line-height: 1.7;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 0.5rem; justify-content: flex-end;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'primary-btn';
        saveBtn.style.padding = '0.3rem 0.9rem';
        saveBtn.style.fontSize = '0.9rem';
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> \u05e9\u05de\u05d5\u05e8';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'secondary-btn';
        resetBtn.style.padding = '0.3rem 0.9rem';
        resetBtn.style.fontSize = '0.9rem';
        resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> \u05d0\u05e4\u05e1';
        resetBtn.style.display = State.editedVerses[key] ? 'inline-block' : 'none';

        saveBtn.addEventListener('click', () => {
            const newText = textarea.value.trim();
            if (!newText) return;
            State.editedVerses[key] = { originalText: newText };
            // Also update the live tanakhVerses for concordance
            const liveVerse = State.tanakhVerses.find(v => v.bookHeb === bookHeb && v.chapter === chapterNum && v.verse === verseNum);
            if (liveVerse) {
                liveVerse.originalText = newText;
                liveVerse.cleanText = stripNikud(newText);
                liveVerse.gematria = calculateGematria(liveVerse.cleanText);
            }
            saveLocalStorage('torah_edited_verses', State.editedVerses);
            label.textContent = `${bookHeb} ${numberToHebrew(chapterNum)}:${numberToHebrew(verseNum)} (\u05e2\u05e8\u05d5\u05da)`;
            resetBtn.style.display = 'inline-block';
            // Flash save button
            saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> \u05e0\u05e9\u05de\u05e8!';
            setTimeout(() => { saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> \u05e9\u05de\u05d5\u05e8'; }, 1500);
        });

        resetBtn.addEventListener('click', () => {
            if (!confirm('\u05d4\u05d0\u05dd \u05dc\u05d0\u05e4\u05e1 \u05d0\u05ea \u05d4\u05e2\u05e8\u05d9\u05db\u05d4?')) return;
            delete State.editedVerses[key];
            const originalText = cleanWords.join(' ');
            textarea.value = originalText;
            // Also update live tanakhVerses
            const liveVerse = State.tanakhVerses.find(v => v.bookHeb === bookHeb && v.chapter === chapterNum && v.verse === verseNum);
            if (liveVerse) {
                liveVerse.originalText = originalText;
                liveVerse.cleanText = stripNikud(originalText);
                liveVerse.gematria = calculateGematria(liveVerse.cleanText);
            }
            saveLocalStorage('torah_edited_verses', State.editedVerses);
            label.textContent = `${bookHeb} ${numberToHebrew(chapterNum)}:${numberToHebrew(verseNum)}`;
            resetBtn.style.display = 'none';
        });

        btnRow.appendChild(resetBtn);
        btnRow.appendChild(saveBtn);
        row.appendChild(label);
        row.appendChild(textarea);
        row.appendChild(btnRow);
        container.appendChild(row);
    });
}


// --- View 10: Rashei Teivot & Sofei Teivot Analysis ---

// Switch target to qere-ketiv-view inside custom navigation
window.addEventListener('DOMContentLoaded', () => {
    // Extend navigation to support qere-ketiv-view target
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            const target = link.getAttribute('data-target');
            if (target === 'qere-ketiv-view') {
                renderQereKetivView();
            }
        });
    });

    // Add role switcher update hook
    const roleSelector = document.getElementById('role-selector');
    if (roleSelector) {
        roleSelector.addEventListener('change', () => {
            if (State.activeView === 'qere-ketiv-view' && State.userRole !== 'admin') {
                switchView('study-hall-view');
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'study-hall-view') {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
            }
        });
    }
});

async function renderQereKetivView() {
    const listEl = document.getElementById('qk-verses-list');
    if (!listEl) return;

    try {
        const response = await fetch('corrupted_verses.json');
        if (!response.ok) throw new Error("קובץ לא קיים");
        qkCandidates = await response.json();
        
        // Initialize default selection on first load
        qkCandidates.forEach((c, idx) => {
            qkSelectedIndices.add(idx);
            if (!qkSelectedOptions[idx]) qkSelectedOptions[idx] = 'ketiv';
        });

        renderQKList();
    } catch (err) {
        console.error("שגיאה בטעינת corrupted_verses.json:", err);
        listEl.innerHTML = `
            <div class="empty-state" style="border-color: var(--error);">
                <div class="empty-state-icon" style="color: var(--error);"><i class="fa-solid fa-circle-exclamation"></i></div>
                <p>שגיאה בטעינת קובץ המקור <code>corrupted_verses.json</code>.</p>
                <p style="font-size: 0.9rem; color: var(--text-muted);">ודא שהרצת את התוכנית למציאת השגיאות או שהקובץ קיים בתיקיית העבודה.</p>
            </div>
        `;
    }
}

function renderQKList() {
    const listEl = document.getElementById('qk-verses-list');
    const totalCountEl = document.getElementById('qk-total-count');
    const selectedCountEl = document.getElementById('qk-selected-count');

    totalCountEl.textContent = qkCandidates.length;
    selectedCountEl.textContent = qkSelectedIndices.size;

    if (qkCandidates.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state" style="border-color: var(--success);">
                <div class="empty-state-icon" style="color: var(--success);"><i class="fa-solid fa-circle-check"></i></div>
                <p style="font-size: 1.2rem; font-weight: bold; color: var(--success);">לא נמצאו שגיאות כפל קרי וכתיב במאגר!</p>
                <p>כל הפסוקים מעודכנים ותקינים.</p>
            </div>
        `;
        return;
    }

    let html = '';
    qkCandidates.forEach((c, idx) => {
        const isSelected = qkSelectedIndices.has(idx);
        const activeOpt = qkSelectedOptions[idx];

        // Format raw verse from sdarim
        let verseText = c.corruptedWord;
        if (c.sdarimVerse) {
            verseText = c.sdarimVerse.split(/\s+/).map(w => {
                const wClean = w.replace(/[\u0591-\u05c7]/g, '');
                if (wClean === c.ketiv) {
                    return `<span style="background: rgba(229, 62, 62, 0.1); border-bottom: 2px solid var(--error); padding: 0 0.2rem; color: var(--error); font-weight: bold;">${w}</span>`;
                }
                return w;
            }).join(' ');
        }

        html += `
            <div class="editor-container" style="margin-bottom: 1rem; border-color: ${isSelected ? 'var(--success)' : 'var(--border-gold)'}; padding: 1.5rem; background: ${isSelected ? 'rgba(46, 125, 50, 0.01)' : 'var(--bg-primary)'};">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border-gold); padding-bottom: 0.5rem; margin-bottom: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; font-weight: bold; color: var(--accent-gold); cursor: pointer;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleQKSelection(${idx})" style="width: 1.15rem; height: 1.15rem; cursor: pointer;">
                        <span>${c.bookHeb} פרק ${numberToHebrew(c.chapter)} פסוק ${numberToHebrew(c.verse)}</span>
                    </label>
                    <span style="font-size: 0.9rem; color: var(--text-muted);">מילה משובשת: <code style="font-size: 1.05rem; color: var(--error);">${c.corruptedWord}</code></span>
                </div>

                <div style="font-family: var(--font-serif); font-size: 1.35rem; line-height: 1.8; padding: 0.5rem; border-right: 3px solid var(--border-gold); background: rgba(var(--accent-gold-rgb), 0.02); margin-bottom: 1rem;">
                    ... ${verseText} ...
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.75rem;">
                    <div style="border: 1px solid ${activeOpt === 'ketiv' ? 'var(--success)' : 'var(--border-gold)'}; padding: 0.75rem; border-radius: var(--border-radius-sm); cursor: pointer; background: ${activeOpt === 'ketiv' ? 'rgba(46, 125, 50, 0.05)' : 'white'};" onclick="setQKOption(${idx}, 'ketiv')">
                        <strong style="color: var(--accent-gold); font-size: 0.9rem; display: block; margin-bottom: 0.25rem;">תיקון לפי ה-כתיב (ללא ניקוד):</strong>
                        <span style="font-family: var(--font-serif); font-size: 1.2rem; font-weight: bold;">${c.ketiv}</span>
                    </div>
                    <div style="border: 1px solid ${activeOpt === 'qere' ? 'var(--success)' : 'var(--border-gold)'}; padding: 0.75rem; border-radius: var(--border-radius-sm); cursor: pointer; background: ${activeOpt === 'qere' ? 'rgba(46, 125, 50, 0.05)' : 'white'};" onclick="setQKOption(${idx}, 'qere')">
                        <strong style="color: var(--accent-gold); font-size: 0.9rem; display: block; margin-bottom: 0.25rem;">תיקון לפי ה-קרי (עם ניקוד):</strong>
                        <span style="font-family: var(--font-serif); font-size: 1.2rem; font-weight: bold;">${c.rest}</span>
                    </div>
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;

    // Attach button listeners if not already bound
    const selectAllBtn = document.getElementById('qk-select-all-btn');
    const applyBtn = document.getElementById('qk-apply-btn');

    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            if (qkSelectedIndices.size === qkCandidates.length) {
                qkSelectedIndices.clear();
            } else {
                qkCandidates.forEach((_, idx) => qkSelectedIndices.add(idx));
            }
            renderQKList();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = async () => {
            if (qkSelectedIndices.size === 0) {
                alert("אנא בחר לפחות פסוק אחד לתיקון.");
                return;
            }

            const fixes = Array.from(qkSelectedIndices).map(idx => ({
                candidate: qkCandidates[idx],
                choice: qkSelectedOptions[idx]
            }));

            try {
                const response = await fetch('/apply_fixes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fixes)
                });
                
                if (response.ok) {
                    alert("התיקונים בוצעו ונשמרו בהצלחה במאגר!");
                    // Reload list
                    renderQereKetivView();
                } else {
                    alert("שגיאה בביצוע התיקונים בשרת.");
                }
            } catch (err) {
                console.error(err);
                alert("הבקשה נכשלה. ודא שהשרת המקומי פועל.");
            }
        };
    }
}

// Global functions for inline DOM event handler attributes
window.toggleQKSelection = function(idx) {
    if (qkSelectedIndices.has(idx)) {
        qkSelectedIndices.delete(idx);
    } else {
        qkSelectedIndices.add(idx);
    }
    renderQKList();
};

window.setQKOption = function(idx, opt) {
    qkSelectedOptions[idx] = opt;
    renderQKList();
};

// --- View 10: Rashei Teivot & Sofei Teivot Analysis ---
function initRasheiTeivot() {
    const input = document.getElementById('rt-input');
    const resultsContainer = document.getElementById('rt-results');
    if (!input || !resultsContainer) return;

    // Sofit -> regular letter map
    const sofitMap = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

    function toRegularLetter(ch) {
        return sofitMap[ch] || ch;
    }

    // Get rashei teivot (first letter of each word)
    function getRashei(text) {
        // Strip nikud/cantillation (U+0591-U+05C7), then replace maqaf/hyphen with space,
        // then keep only Hebrew letters and spaces
        const clean = text
            .replace(/[\u0591-\u05C7]/g, '')   // nikud & cantillation
            .replace(/[\u05BE\u05F3\u05F4\u200D\u200C\uFB1D-\uFB4E]/g, ' ')  // maqaf & special chars -> space
            .replace(/[^\u05D0-\u05EA\s]/g, '') // keep only Hebrew letters & whitespace
            .replace(/\s+/g, ' ')
            .trim();
        if (!clean) return '';
        return clean.split(' ').filter(w => w.length > 0).map(w => w[0]).join('');
    }

    // Get sofei teivot (last letter of each word, converted to regular form)
    function getSofei(text) {
        // Strip nikud/cantillation (U+0591-U+05C7), then replace maqaf/hyphen with space,
        // then keep only Hebrew letters and spaces
        const clean = text
            .replace(/[\u0591-\u05C7]/g, '')   // nikud & cantillation
            .replace(/[\u05BE\u05F3\u05F4\u200D\u200C\uFB1D-\uFB4E]/g, ' ')  // maqaf & special chars -> space
            .replace(/[^\u05D0-\u05EA\s]/g, '') // keep only Hebrew letters & whitespace
            .replace(/\s+/g, ' ')
            .trim();
        if (!clean) return '';
        return clean.split(' ').filter(w => w.length > 0).map(w => {
            const lastChar = w[w.length - 1];
            return toRegularLetter(lastChar);
        }).join('');
    }

    // Sort letters alphabetically for anagram comparison
    function sortLetters(str) {
        return str.split('').sort().join('');
    }

    // Pre-compute rashei/sofei for all tanakh verses (lazy, cached)
    function ensureCache() {
        const RT_CACHE_VERSION = 2; // bump to invalidate cached data
        if (State.rtCache && State.rtCache.length === State.tanakhVerses.length && State.rtCacheVersion === RT_CACHE_VERSION) return;
        State.rtCacheVersion = RT_CACHE_VERSION;
        console.time("RT Cache Build");
        State.rtCache = State.tanakhVerses.map(v => {
            const r = getRashei(v.originalText);
            const s = getSofei(v.originalText);
            return {
                verse: v,
                rashei: r,
                sofei: s,
                rasheiSorted: sortLetters(r),
                sofeiSorted: sortLetters(s),
                rasheiGematria: calculateGematria(r),
                sofeiGematria: calculateGematria(s)
            };
        });
        console.timeEnd("RT Cache Build");
    }

    // Show inline detail panel for a verse (in RT page)
    function showRtDetailVerse(v) {
        const panel = document.getElementById('rt-detail-panel');
        const titleEl = document.getElementById('rt-detail-title');
        const contentEl = document.getElementById('rt-detail-content');
        if (!panel || !titleEl || !contentEl) return;

        const r = getRashei(v.originalText);
        const s = getSofei(v.originalText);
        const gem = v.gematria || calculateGematria(v.originalText);
        const sourceLabel = `${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)}`;

        titleEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span><i class="fa-solid fa-book-open"></i> פסוק: ${sourceLabel}</span>
                <button type="button" class="category-tab rt-detail-copy-btn" style="padding: 0.2rem 0.6rem; font-size: 0.8rem; cursor: pointer; color: var(--accent-gold); border-color: var(--border-gold);">
                    <i class="fa-solid fa-copy"></i> העתק
                </button>
            </div>
        `;
        const rtCopyBtn = titleEl.querySelector('.rt-detail-copy-btn');
        if (rtCopyBtn) {
            rtCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.copyPlainText(`${v.originalText} (${sourceLabel})`, rtCopyBtn);
            });
        }
        contentEl.innerHTML = `
            <div style="font-family: var(--font-serif); font-size: 1.45rem; line-height: 1.8; text-align: center; margin-bottom: 1.25rem; padding: 1rem; border-right: 3px solid var(--border-gold); background: rgba(var(--accent-gold-rgb), 0.03);">
                ${v.originalText}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.95rem; color: var(--text-muted);">
                <span>גימטריה: <strong style="color: var(--accent-gold);">${gem}</strong></span>
                <span>ראשי תיבות: <strong style="color: var(--accent-gold);">${r}</strong> (גימטריה: ${calculateGematria(r)})</span>
                <span>סופי תיבות: <strong style="color: var(--accent-gold);">${s}</strong> (גימטריה: ${calculateGematria(s)})</span>
            </div>
        `;
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Render a verse list into a container
    function renderVerseList(container, items, limit) {
        container.innerHTML = '';
        limit = limit || 50;
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><p>לא נמצאו פסוקים תואמים.</p></div>';
            return;
        }

        const topBar = document.createElement('div');
        topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.5rem;';
        
        const note = document.createElement('div');
        note.style.cssText = 'color: var(--accent-gold); font-weight: bold; font-size: 0.95rem;';
        note.innerText = items.length > limit ? `נמצאו ${items.length} פסוקים (מציג ${limit}):` : `נמצאו ${items.length} פסוקים:`;
        topBar.appendChild(note);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'category-tab';
        copyBtn.style.cssText = 'padding: 0.25rem 0.65rem; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 0.35rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק פסוקים';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const plainLines = items.map(item => {
                const v = item.verse || item;
                const src = `(${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)})`;
                return `${v.originalText} ${src}`;
            });
            window.copyPlainText(plainLines.join('\n'), copyBtn);
        });
        topBar.appendChild(copyBtn);
        container.appendChild(topBar);

        const display = items.slice(0, limit);
        display.forEach(item => {
            const v = item.verse || item;
            const div = document.createElement('div');
            div.style.cssText = 'cursor: pointer; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color); transition: color 0.2s;';
            div.addEventListener('mouseenter', () => { div.style.color = 'var(--accent-gold)'; });
            div.addEventListener('mouseleave', () => { div.style.color = ''; });
            div.addEventListener('click', () => {
                showRtDetailVerse(v);
            });
            const sourceLabel = `(${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)})`;
            // Show rashei/sofei of this verse inline
            let extraInfo = '';
            if (item.rashei !== undefined) {
                extraInfo = `<span style="color: var(--text-muted); font-size: 0.9rem; margin-right: 0.5rem;">[ר"ת: ${item.rashei} | ס"ת: ${item.sofei}]</span>`;
            }
            div.innerHTML = `${v.originalText}<span style="color: var(--accent-gold); font-size: 1rem; font-family: var(--font-sans); margin-right: 0.25rem;">${sourceLabel}</span>${extraInfo}`;
            container.appendChild(div);
        });
    }

    // Tab switching
    const tabs = document.querySelectorAll('.rt-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-rt-tab');
            document.querySelectorAll('.rt-panel').forEach(panel => {
                panel.style.display = 'none';
            });
            const targetPanel = document.getElementById('rt-panel-' + target);
            if (targetPanel) targetPanel.style.display = 'block';
        });
    });

    // Copy buttons for Rashei & Sofei letters
    const copyRasheiBtn = document.getElementById('rt-copy-rashei-btn');
    if (copyRasheiBtn) {
        copyRasheiBtn.addEventListener('click', () => {
            const txt = document.getElementById('rt-rashei-letters').textContent.trim();
            window.copyPlainText(txt, copyRasheiBtn);
        });
    }

    const copySofeiBtn = document.getElementById('rt-copy-sofei-btn');
    if (copySofeiBtn) {
        copySofeiBtn.addEventListener('click', () => {
            const txt = document.getElementById('rt-sofei-letters').textContent.trim();
            window.copyPlainText(txt, copySofeiBtn);
        });
    }

    // Debounce timer
    let debounceTimer = null;

    input.addEventListener('input', () => {
        const val = input.value.trim();
        
        // Sync shared verse
        State.sharedVerse = val;
        localStorage.setItem('torah_shared_verse', val);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (!val) {
                resultsContainer.style.display = 'none';
                return;
            }

            addToHistory('rashei', val);

            const rashei = getRashei(val);
            const sofei = getSofei(val);
            if (!rashei && !sofei) {
                resultsContainer.style.display = 'none';
                return;
            }

            resultsContainer.style.display = 'block';

            // 1. Show rashei teivot + gematria
            const rasheiGem = calculateGematria(rashei);
            document.getElementById('rt-rashei-letters').textContent = rashei;
            document.getElementById('rt-rashei-gematria').textContent = rasheiGem;

            // 2. Show sofei teivot + gematria
            const sofeiGem = calculateGematria(sofei);
            document.getElementById('rt-sofei-letters').textContent = sofei;
            document.getElementById('rt-sofei-gematria').textContent = sofeiGem;

            // Build cache
            ensureCache();

            const rasheiSorted = sortLetters(rashei);
            const sofeiSorted = sortLetters(sofei);

            // 3. Exact rashei matches
            const exactRasheiMatches = State.rtCache.filter(c => c.rashei === rashei);
            renderVerseList(document.getElementById('rt-list-exact-rashei'), exactRasheiMatches);
            updateTabCount('exact-rashei', exactRasheiMatches.length);

            // 4. Exact sofei matches
            const exactSofeiMatches = State.rtCache.filter(c => c.sofei === sofei);
            renderVerseList(document.getElementById('rt-list-exact-sofei'), exactSofeiMatches);
            updateTabCount('exact-sofei', exactSofeiMatches.length);

            // 5. Anagram rashei (same letters, different order - exclude exact matches)
            const anagramRasheiMatches = State.rtCache.filter(c => c.rasheiSorted === rasheiSorted && c.rashei !== rashei);
            renderVerseList(document.getElementById('rt-list-anagram-rashei'), anagramRasheiMatches);
            updateTabCount('anagram-rashei', anagramRasheiMatches.length);

            // 6. Anagram sofei (same letters, different order - exclude exact matches)
            const anagramSofeiMatches = State.rtCache.filter(c => c.sofeiSorted === sofeiSorted && c.sofei !== sofei);
            renderVerseList(document.getElementById('rt-list-anagram-sofei'), anagramSofeiMatches);
            updateTabCount('anagram-sofei', anagramSofeiMatches.length);

            // 7. Gematria rashei matches (same gematria value)
            const gematriaRasheiMatches = State.rtCache.filter(c => c.rasheiGematria === rasheiGem);
            renderVerseList(document.getElementById('rt-list-gematria-rashei'), gematriaRasheiMatches);
            updateTabCount('gematria-rashei', gematriaRasheiMatches.length);

            // 8. Gematria sofei matches (same gematria value)
            const gemartriaSofeiMatches = State.rtCache.filter(c => c.sofeiGematria === sofeiGem);
            renderVerseList(document.getElementById('rt-list-gematria-sofei'), gemartriaSofeiMatches);
            updateTabCount('gematria-sofei', gemartriaSofeiMatches.length);

            // 9. Words anagram from rashei
            const wordsRasheiCount = renderWordsAnagramList(document.getElementById('rt-list-words-anagram-rashei'), rashei);
            updateTabCount('words-anagram-rashei', wordsRasheiCount);

            // 10. Words anagram from sofei
            const wordsSofeiCount = renderWordsAnagramList(document.getElementById('rt-list-words-anagram-sofei'), sofei);
            updateTabCount('words-anagram-sofei', wordsSofeiCount);

        }, 400); // 400ms debounce to avoid lag while typing
    });

    function updateTabCount(tabName, count) {
        const tab = document.querySelector(`.rt-tab[data-rt-tab="${tabName}"]`);
        if (tab) {
            const labels = {
                'exact-rashei': '3. ראשי תיבות זהים',
                'exact-sofei': '4. סופי תיבות זהים',
                'anagram-rashei': '5. אנגרמת ראשי תיבות',
                'anagram-sofei': '6. אנגרמת סופי תיבות',
                'gematria-rashei': '7. גימטריה ראשי תיבות',
                'gematria-sofei': '8. גימטריה סופי תיבות',
                'words-anagram-rashei': '9. הרכבת מילים מראשי תיבות',
                'words-anagram-sofei': '10. הרכבת מילים מסופי תיבות'
            };
            tab.textContent = `${labels[tabName]} (${count})`;
        }
    }
}

// --- Anagram Color Categorization Helpers (Global Scope) ---
function normalizeForAnagram(str) {
    if (!str) return '';
    const sofitMap = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
    return str
        .replace(/[\u0591-\u05C7]/g, '')
        .replace(/[\u05BE\u05F3\u05F4\u200D\u200C]/g, '')
        .replace(/[^\u05D0-\u05EA]/g, '')
        .split('')
        .map(ch => sofitMap[ch] || ch)
        .join('');
}

function isSubsequence(sub, str) {
    let subIdx = 0;
    for (let i = 0; i < str.length && subIdx < sub.length; i++) {
        if (str[i] === sub[subIdx]) {
            subIdx++;
        }
    }
    return subIdx === sub.length;
}

function isNearSubsequence(word, source) {
    if (word.length < 3) return false;
    for (let i = 0; i < word.length; i++) {
        const sub = word.slice(0, i) + word.slice(i + 1);
        if (isSubsequence(sub, source)) return true;
    }
    return false;
}

function isNearContiguousForward(word, source) {
    if (word.length < 3) return false;
    // Check 1: removing 1 char from word leaves a contiguous substring in source
    for (let i = 0; i < word.length; i++) {
        const sub = word.slice(0, i) + word.slice(i + 1);
        if (source.includes(sub)) return true;
    }
    // Check 2: contiguous substring of source of length (word.length + 1) matches word with 1 char removed
    const wLen = word.length;
    for (let i = 0; i <= source.length - (wLen + 1); i++) {
        const sSub = source.slice(i, i + wLen + 1);
        for (let j = 0; j < sSub.length; j++) {
            const cand = sSub.slice(0, j) + sSub.slice(j + 1);
            if (cand === word) return true;
        }
    }
    return false;
}

function getAnagramCategory(word, sourceText) {
    const S = normalizeForAnagram(sourceText);
    const W = normalizeForAnagram(word);
    if (!S || !W) return 'default';

    const W_rev = W.split('').reverse().join('');

    // 1. Gold (זהב): Exact contiguous substring forward
    if (S.includes(W)) {
        return 'gold';
    }

    // 2. Silver (כסף): Exact contiguous substring backward
    if (S.includes(W_rev)) {
        return 'silver';
    }

    // 3. Red (אדום): Subsequence forward (with gaps)
    if (isSubsequence(W, S)) {
        return 'red';
    }

    // 4. Pink (ורוד): Subsequence backward (with gaps)
    if (isSubsequence(W_rev, S)) {
        return 'pink';
    }

    // 5. Blue (כחול): Forward with 1 letter out of sequence (contiguous block minus 1 letter)
    if (isNearContiguousForward(W, S)) {
        return 'blue';
    }

    // 6. Green (ירוק): Backward with 1 letter out of sequence (contiguous block minus 1 letter)
    if (isNearContiguousForward(W_rev, S)) {
        return 'green';
    }

    // 7. Orange (כתום): Subsequence forward with 1 letter out of sequence (with gaps)
    if (isNearSubsequence(W, S)) {
        return 'orange';
    }

    // 8. Purple (סגול): Subsequence backward with 1 letter out of sequence (with gaps)
    if (isNearSubsequence(W_rev, S)) {
        return 'purple';
    }

    return 'default';
}

function getAnagramCategoryStyle(category) {
    switch (category) {
        case 'gold':
            return {
                bg: '#fef08a',         // Soft Gold Yellow
                border: '1px solid #eab308',
                color: '#000000',      // Black text
                countColor: '#b45309'  // Gold count
            };
        case 'silver':
            return {
                bg: '#e2e8f0',         // Silver Gray
                border: '1px solid #94a3b8',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'red':
            return {
                bg: '#fca5a5',         // Light Red
                border: '1px solid #ef4444',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'pink':
            return {
                bg: '#fbcfe8',         // Soft Pink
                border: '1px solid #ec4899',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'blue':
            return {
                bg: '#bfdbfe',         // Soft Blue
                border: '1px solid #3b82f6',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'green':
            return {
                bg: '#bbf7d0',         // Soft Green
                border: '1px solid #22c55e',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'orange':
            return {
                bg: '#fed7aa',         // Soft Orange
                border: '1px solid #f97316',
                color: '#000000',
                countColor: '#b45309'
            };
        case 'purple':
            return {
                bg: '#e9d5ff',         // Soft Purple
                border: '1px solid #a855f7',
                color: '#000000',
                countColor: '#b45309'
            };
        default:
            return {
                bg: '#f3f4f6',
                border: '1px solid #cbd5e1',
                color: '#000000',
                countColor: '#b45309'
            };
    }
}

function getAnagramLegendHtml() {
    return `
        <div class="anagram-color-legend" style="background: var(--bg-secondary); border: 1px solid var(--border-gold); border-radius: var(--border-radius-md); padding: 0.75rem 1rem; margin-bottom: 1rem; font-family: var(--font-sans); font-size: 0.85rem;">
            <div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-palette"></i> מקרא סיווג צבעי המילים (ממוין לפי סדר חשיבות):
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center;">
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #fef08a; border: 1px solid #eab308; display: inline-block;"></span>
                    <strong style="color: #eab308;">זהב:</strong> אותיות ברצף מלא
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #e2e8f0; border: 1px solid #94a3b8; display: inline-block;"></span>
                    <strong style="color: #94a3b8;">כסף:</strong> אותיות ברצף (הפוך)
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #fca5a5; border: 1px solid #ef4444; display: inline-block;"></span>
                    <strong style="color: #ef4444;">אדום:</strong> אותיות כסדרן (עם דילוגים)
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #fbcfe8; border: 1px solid #ec4899; display: inline-block;"></span>
                    <strong style="color: #ec4899;">ורוד:</strong> אותיות כסדרן הפוך (דילוגים)
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #bfdbfe; border: 1px solid #3b82f6; display: inline-block;"></span>
                    <strong style="color: #3b82f6;">כחול:</strong> ברצף מלבד אות אחת
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #bbf7d0; border: 1px solid #22c55e; display: inline-block;"></span>
                    <strong style="color: #22c55e;">ירוק:</strong> ברצף הפוך מלבד אות אחת
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #fed7aa; border: 1px solid #f97316; display: inline-block;"></span>
                    <strong style="color: #ea580c;">כתום:</strong> אותיות כסדרן (דילוגים) מלבד אות אחת
                </span>
                <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: #e9d5ff; border: 1px solid #a855f7; display: inline-block;"></span>
                    <strong style="color: #a855f7;">סגול:</strong> אותיות הפוך (דילוגים) מלבד אות אחת
                </span>
            </div>
        </div>
    `;
}

const ANAGRAM_CATEGORIES_CONFIG = [
    { key: 'gold', name: 'זהב: אותיות ברצף מלא', dotBorder: '#eab308', dotBg: '#fef08a' },
    { key: 'silver', name: 'כסף: אותיות ברצף (הפוך)', dotBorder: '#94a3b8', dotBg: '#e2e8f0' },
    { key: 'red', name: 'אדום: אותיות כסדרן (עם דילוגים)', dotBorder: '#ef4444', dotBg: '#fca5a5' },
    { key: 'pink', name: 'ורוד: אותיות כסדרן הפוך (דילוגים)', dotBorder: '#ec4899', dotBg: '#fbcfe8' },
    { key: 'blue', name: 'כחול: ברצף מלבד אות אחת', dotBorder: '#3b82f6', dotBg: '#bfdbfe' },
    { key: 'green', name: 'ירוק: ברצף הפוך מלבד אות אחת', dotBorder: '#22c55e', dotBg: '#bbf7d0' },
    { key: 'orange', name: 'כתום: אותיות כסדרן (דילוגים) מלבד אות אחת', dotBorder: '#f97316', dotBg: '#fed7aa' },
    { key: 'purple', name: 'סגול: אותיות הפוך (דילוגים) מלבד אות אחת', dotBorder: '#a855f7', dotBg: '#e9d5ff' },
    { key: 'default', name: 'אחר: ללא סיווג מיוחד', dotBorder: '#cbd5e1', dotBg: '#f3f4f6' }
];

const categoryRank = {
    'gold': 1,
    'silver': 2,
    'red': 3,
    'pink': 4,
    'blue': 5,
    'green': 6,
    'orange': 7,
    'purple': 8,
    'default': 9
};

// Helper function to render anagram cards either by length or by category
function renderAnagramCards(cardsContainer, matches, sourceText, sortMode, onPillClick) {
    cardsContainer.innerHTML = '';
    
    if (sortMode === 'category') {
        // Group by category
        const groupsByCat = {};
        ANAGRAM_CATEGORIES_CONFIG.forEach(c => { groupsByCat[c.key] = []; });
        
        matches.forEach(item => {
            const cat = getAnagramCategory(item.word, sourceText);
            if (!groupsByCat[cat]) groupsByCat[cat] = [];
            groupsByCat[cat].push(item);
        });

        ANAGRAM_CATEGORIES_CONFIG.forEach(catConfig => {
            const wordsInGroup = groupsByCat[catConfig.key];
            if (!wordsInGroup || wordsInGroup.length === 0) return;

            // Sort words within category: length descending, then occurrence count descending, then alphabetical
            wordsInGroup.sort((a, b) => {
                if (b.length !== a.length) {
                    return b.length - a.length;
                }
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                return a.word.localeCompare(b.word, 'he');
            });

            const groupCard = document.createElement('div');
            groupCard.className = 'anagram-length-group';
            groupCard.style.cssText = "background: var(--bg-secondary); border: 1px solid var(--border-gold); border-radius: var(--border-radius-md); padding: 1rem 1.25rem; margin-bottom: 1rem;";

            const header = document.createElement('h4');
            header.style.cssText = "color: var(--accent-gold); margin: 0 0 0.75rem 0; font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;";
            header.innerHTML = `
                <span style="display: inline-flex; align-items: center; gap: 0.5rem;">
                    <span style="width: 14px; height: 14px; border-radius: 3px; background: ${catConfig.dotBg}; border: 1px solid ${catConfig.dotBorder}; display: inline-block;"></span>
                    <span>${catConfig.name}</span>
                </span>
                <span style="font-size: 0.85rem; background: rgba(var(--accent-gold-rgb), 0.18); color: var(--accent-gold); padding: 0.1rem 0.6rem; border-radius: 12px; font-weight: bold;">
                    ${wordsInGroup.length} מילים
                </span>
            `;
            groupCard.appendChild(header);

            const wordsList = document.createElement('div');
            wordsList.style.cssText = "display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; font-family: var(--font-sans);";

            wordsInGroup.forEach(item => {
                const category = catConfig.key;
                const st = getAnagramCategoryStyle(category);

                const pill = document.createElement('span');
                pill.className = 'anagram-word-pill';
                pill.title = `לחץ לחיפוש '${item.word}' במאגר הפסוקים`;
                pill.style.cssText = `cursor: pointer; padding: 0.35rem 0.7rem; border: ${st.border}; background: ${st.bg}; color: ${st.color}; border-radius: var(--border-radius-sm); font-size: 1.05rem; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600;`;
                pill.innerHTML = `<span>${item.word}</span> <strong style="color: ${st.countColor}; font-size: 0.9rem; font-weight: 800;">(${item.count.toLocaleString('he-IL')})</strong>`;

                pill.addEventListener('mouseenter', () => {
                    pill.style.transform = 'translateY(-1px)';
                    pill.style.boxShadow = '0 3px 10px rgba(0,0,0,0.3)';
                });
                pill.addEventListener('mouseleave', () => {
                    pill.style.transform = 'none';
                    pill.style.boxShadow = 'none';
                });

                if (onPillClick) {
                    pill.addEventListener('click', () => onPillClick(item));
                }

                wordsList.appendChild(pill);
            });

            groupCard.appendChild(wordsList);
            cardsContainer.appendChild(groupCard);
        });
    } else {
        // Group by length (default)
        const groupsByLength = {};
        matches.forEach(item => {
            if (!groupsByLength[item.length]) {
                groupsByLength[item.length] = [];
            }
            groupsByLength[item.length].push(item);
        });

        const sortedLengths = Object.keys(groupsByLength).map(Number).sort((a, b) => b - a);

        sortedLengths.forEach(len => {
            const wordsInGroup = groupsByLength[len];
            
            // Sort words within group: category rank first, then occurrence count descending, then alphabetical
            wordsInGroup.sort((a, b) => {
                const catA = getAnagramCategory(a.word, sourceText);
                const catB = getAnagramCategory(b.word, sourceText);
                const rankA = categoryRank[catA] || 9;
                const rankB = categoryRank[catB] || 9;

                if (rankA !== rankB) {
                    return rankA - rankB;
                }
                if (b.count !== a.count) {
                    return b.count - a.count;
                }
                return a.word.localeCompare(b.word, 'he');
            });

            const groupCard = document.createElement('div');
            groupCard.className = 'anagram-length-group';
            groupCard.style.cssText = "background: var(--bg-secondary); border: 1px solid var(--border-gold); border-radius: var(--border-radius-md); padding: 1rem 1.25rem; margin-bottom: 1rem;";

            const header = document.createElement('h4');
            header.style.cssText = "color: var(--accent-gold); margin: 0 0 0.75rem 0; font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.4rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;";
            header.innerHTML = `
                <span><i class="fa-solid fa-font"></i> מילים בנות ${len} אותיות</span>
                <span style="font-size: 0.85rem; background: rgba(var(--accent-gold-rgb), 0.18); color: var(--accent-gold); padding: 0.1rem 0.6rem; border-radius: 12px; font-weight: bold;">
                    ${wordsInGroup.length} מילים
                </span>
            `;
            groupCard.appendChild(header);

            const wordsList = document.createElement('div');
            wordsList.style.cssText = "display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; font-family: var(--font-sans);";

            wordsInGroup.forEach(item => {
                const category = getAnagramCategory(item.word, sourceText);
                const st = getAnagramCategoryStyle(category);

                const pill = document.createElement('span');
                pill.className = 'anagram-word-pill';
                pill.title = `לחץ לחיפוש '${item.word}' במאגר הפסוקים`;
                pill.style.cssText = `cursor: pointer; padding: 0.35rem 0.7rem; border: ${st.border}; background: ${st.bg}; color: ${st.color}; border-radius: var(--border-radius-sm); font-size: 1.05rem; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600;`;
                pill.innerHTML = `<span>${item.word}</span> <strong style="color: ${st.countColor}; font-size: 0.9rem; font-weight: 800;">(${item.count.toLocaleString('he-IL')})</strong>`;

                pill.addEventListener('mouseenter', () => {
                    pill.style.transform = 'translateY(-1px)';
                    pill.style.boxShadow = '0 3px 10px rgba(0,0,0,0.3)';
                });
                pill.addEventListener('mouseleave', () => {
                    pill.style.transform = 'none';
                    pill.style.boxShadow = 'none';
                });

                if (onPillClick) {
                    pill.addEventListener('click', () => onPillClick(item));
                }

                wordsList.appendChild(pill);
            });

            groupCard.appendChild(wordsList);
            cardsContainer.appendChild(groupCard);
        });
    }
}

// Render word anagram pills grouped by length or category
function renderWordsAnagramList(container, letterString) {
    container.innerHTML = '';
    if (!letterString) {
        container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><p>אין אותיות לחישוב.</p></div>';
        return 0;
    }

    const counts = getHebrewLetterCounts(letterString);
    const totalLetters = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalLetters < 3) {
        container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><p>נדרשות לפחות 3 אותיות להרכבת מילים.</p></div>';
        return 0;
    }

    const corpus = ensureTanakhWordCorpus();
    const matches = [];

    for (let item of corpus) {
        if (item.length >= 3 && item.length <= totalLetters) {
            if (canFormWordFromCounts(item.normCounts, counts)) {
                matches.push(item);
            }
        }
    }

    if (matches.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><p>לא נמצאו מילים במאגר התנ"ך בנות 3 אותיות ומעלה שניתן להרכיב מאותיות אלו.</p></div>';
        return 0;
    }

    // Add legend at top of container
    const legendDiv = document.createElement('div');
    legendDiv.innerHTML = getAnagramLegendHtml();
    container.appendChild(legendDiv.firstElementChild);

    // Sort Mode controls
    let sortMode = container._anagramSortMode || 'length';

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'anagram-sort-controls';
    controlsDiv.style.cssText = "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; background: var(--bg-primary); border: 1px solid var(--border-gold); padding: 0.45rem 0.85rem; border-radius: var(--border-radius-sm);";
    
    controlsDiv.innerHTML = `
        <div style="font-weight: bold; color: var(--accent-gold); font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem;">
            <i class="fa-solid fa-arrow-down-a-z"></i> תצוגת סידור:
        </div>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;">
            <button type="button" class="category-tab anagram-sort-btn-len ${sortMode === 'length' ? 'active' : ''}" style="padding: 0.25rem 0.65rem; font-size: 0.82rem;">
                <i class="fa-solid fa-text-width"></i> לפי כמות אותיות
            </button>
            <button type="button" class="category-tab anagram-sort-btn-cat ${sortMode === 'category' ? 'active' : ''}" style="padding: 0.25rem 0.65rem; font-size: 0.82rem;">
                <i class="fa-solid fa-palette"></i> לפי קטגוריות
            </button>
            <button type="button" class="category-tab anagram-copy-btn" style="padding: 0.25rem 0.65rem; font-size: 0.82rem; color: var(--accent-gold); border-color: var(--border-gold); margin-right: 0.35rem; cursor: pointer;">
                <i class="fa-solid fa-copy"></i> העתק תוצאות
            </button>
        </div>
    `;
    container.appendChild(controlsDiv);

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'anagram-cards-container';
    container.appendChild(cardsContainer);

    function onPillClick(item) {
        if (typeof showUvaDetailQuery === 'function') {
            showUvaDetailQuery(item.word);
        } else {
            const wordSearchInput = document.getElementById('word-search-input');
            if (wordSearchInput) {
                wordSearchInput.value = item.word;
                switchView('word-repetition-view');
                document.querySelectorAll('.nav-link').forEach(link => {
                    if (link.getAttribute('data-target') === 'word-repetition-view') {
                        link.classList.add('active');
                    } else {
                        link.classList.remove('active');
                    }
                });
                wordSearchInput.dispatchEvent(new Event('input'));
            }
        }
    }

    function updateView() {
        controlsDiv.querySelector('.anagram-sort-btn-len').classList.toggle('active', sortMode === 'length');
        controlsDiv.querySelector('.anagram-sort-btn-cat').classList.toggle('active', sortMode === 'category');
        renderAnagramCards(cardsContainer, matches, letterString, sortMode, onPillClick);
    }

    controlsDiv.querySelector('.anagram-sort-btn-len').addEventListener('click', () => {
        sortMode = 'length';
        container._anagramSortMode = 'length';
        updateView();
    });

    controlsDiv.querySelector('.anagram-sort-btn-cat').addEventListener('click', () => {
        sortMode = 'category';
        container._anagramSortMode = 'category';
        updateView();
    });

    controlsDiv.querySelector('.anagram-copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        let plainText = '';
        if (sortMode === 'category') {
            const groupsByCat = {};
            ANAGRAM_CATEGORIES_CONFIG.forEach(c => { groupsByCat[c.key] = []; });
            matches.forEach(it => {
                const cat = getAnagramCategory(it.word, letterString);
                if (!groupsByCat[cat]) groupsByCat[cat] = [];
                groupsByCat[cat].push(it);
            });
            const sections = [];
            ANAGRAM_CATEGORIES_CONFIG.forEach(catConfig => {
                const list = groupsByCat[catConfig.key];
                if (!list || list.length === 0) return;
                const wordsStr = list.map(w => `${w.word} (${w.count})`).join(', ');
                sections.push(`${catConfig.name} (${list.length} מילים):\n${wordsStr}`);
            });
            plainText = sections.join('\n\n');
        } else {
            const groupsByLength = {};
            matches.forEach(it => {
                if (!groupsByLength[it.length]) groupsByLength[it.length] = [];
                groupsByLength[it.length].push(it);
            });
            const sortedLens = Object.keys(groupsByLength).map(Number).sort((a, b) => b - a);
            const sections = [];
            sortedLens.forEach(l => {
                const list = groupsByLength[l];
                const wordsStr = list.map(w => `${w.word} (${w.count})`).join(', ');
                sections.push(`מילים בנות ${l} אותיות (${list.length} מילים):\n${wordsStr}`);
            });
            plainText = sections.join('\n\n');
        }
        window.copyPlainText(plainText, controlsDiv.querySelector('.anagram-copy-btn'));
    });

    updateView();

    return matches.length;
}

// --- Auto Verse Analysis ---
function runAutoAnalysis(text, containerId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    
    if (!text || !State.tanakhVerses || State.tanakhVerses.length === 0) {
        box.style.display = 'none';
        return;
    }
    
    // 1. Gematria
    const cleanTextForGematria = stripNikud(text).replace(/[^א-ת\s]/g, "").replace(/\s+/g, " ").trim();
    if (!cleanTextForGematria) {
        box.style.display = 'none';
        return;
    }
    const gVal = calculateGematria(text);
    const gMatches = State.tanakhVerses.filter(v => v.gematria === gVal);
    let gHtml = '';
    if (gMatches.length > 1) {
        const dMatches = gMatches.slice(0, 50);
        gHtml = dMatches.map(v => 
            `<div style="margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                <strong>${v.bookHeb} ${numberToHebrew(v.chapter)}, ${numberToHebrew(v.verse)}:</strong> ${v.originalText}
            </div>`
        ).join('') + (gMatches.length > 50 ? `<div style="text-align:center; color:var(--text-muted); font-size:0.9rem;">...ועוד ${gMatches.length - 50} תוצאות</div>` : '');
    } else {
        gHtml = 'לא נמצאו פסוקים נוספים עם גימטריה זהה בכל התנ"ך.';
    }
    
    // 2. Word Repetition (Singles, Pairs, Triplets, Quadruplets)
    const cleanWords = cleanTextForGematria.split(' ').filter(w => w.length > 0);
    let repHtml = '';
    
    const nGrams = [];
    for (let n = 1; n <= 4; n++) {
        for (let i = 0; i <= cleanWords.length - n; i++) {
            nGrams.push(cleanWords.slice(i, i + n).join(' '));
        }
    }
    
    const uniqueGrams = [...new Set(nGrams)];
    uniqueGrams.forEach(gram => {
        if (gram.length < 2) return;
        const regex = new RegExp('(^|[^א-ת])' + gram + '($|[^א-ת])');
        const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;
        if (count >= 2 && count <= 6) {
            repHtml += `<span style="padding: 0.3rem 0.6rem; border-radius: 4px; background: #ffe3e3; border: 2px solid #ff8787; font-weight: 900; color: #c92a2a; margin: 0.2rem; display: inline-block; cursor: pointer;" title="מופיע ${count} פעמים בתנ״ך" onclick="if(window.showUvaDetailQuery){showUvaDetailQuery('${gram}');}else{document.querySelector('[data-target=\\'word-repetition-view\\']').click();setTimeout(()=>{document.getElementById('word-search-input').value='${gram}';document.getElementById('word-search-input').dispatchEvent(new Event('input'));},100);}">${gram} (${count})</span>`;
        }
    });
    
    // 3. RT/ST
    function convertSofit(c) {
        const m = {'ם':'מ', 'ן':'נ', 'ץ':'צ', 'ף':'פ', 'ך':'כ'};
        return m[c] || c;
    }
    const cleanWordList = cleanWords.filter(w => w.length > 0);
    const rt = cleanWordList.map(w => w[0]).join('');
    const st = cleanWordList.map(w => convertSofit(w[w.length - 1])).join('');
    
    const rtScore = calculateGematria(rt);
    const stScore = calculateGematria(st);
    
    const rtExact = State.tanakhVerses.filter(v => v.rashei === rt).length;
    const stExact = State.tanakhVerses.filter(v => v.sofei === st).length;
    
    const rtAnagramMatch = rt ? State.tanakhVerses.filter(v => v.rasheiSort === rt.split('').sort().join('')).length : 0;
    const stAnagramMatch = st ? State.tanakhVerses.filter(v => v.sofeiSort === st.split('').sort().join('')).length : 0;
    
    box.innerHTML = `
        <h3 style="margin-bottom: 1rem; color: var(--accent-gold); text-align: center; font-size: 1.3rem;"><i class="fa-solid fa-wand-magic-sparkles"></i> ניתוח אוטומטי לפסוק</h3>
        
        <!-- Gematria Auto -->
        <div style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                <h4 style="margin: 0;"><i class="fa-solid fa-calculator"></i> גימטריה: <span style="color: var(--accent-gold);">${gVal} (${numberToHebrew(gVal)})</span></h4>
                ${gMatches.length > 0 ? `<button type="button" class="category-tab" onclick="const lines = State.tanakhVerses.filter(v => v.gematria === ${gVal}).map(v => v.originalText + ' (' + v.bookHeb + ' ' + numberToHebrew(v.chapter) + ',' + numberToHebrew(v.verse) + ')').join('\\n'); window.copyPlainText(lines, this);" style="padding: 0.2rem 0.55rem; font-size: 0.78rem; cursor: pointer; color: var(--accent-gold); border-color: var(--border-gold);"><i class="fa-solid fa-copy"></i> העתק פסוקים</button>` : ''}
            </div>
            <div style="max-height: 200px; overflow-y: auto; background: var(--bg-secondary); padding: 1rem; border-radius: var(--border-radius-md); font-size: 0.9rem;">
                ${gHtml}
            </div>
        </div>
        
        <!-- Repetition Auto -->
        ${repHtml ? `
        <div style="margin-bottom: 1.5rem;">
            <h4 style="margin-bottom: 0.5rem;"><i class="fa-solid fa-arrows-rotate"></i> חזרת מילים (2-6 מופעים בכל התנ"ך)</h4>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; background: var(--bg-secondary); padding: 1rem; border-radius: var(--border-radius-md);">
                ${repHtml}
            </div>
        </div>
        ` : ''}
        
        <!-- RT/ST Auto -->
        <div>
            <h4 style="margin-bottom: 0.5rem;"><i class="fa-solid fa-spell-check"></i> ראשי וסופי תיבות</h4>
            <div style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--border-radius-md); font-size: 0.9rem;">
                <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <strong>ראשי תיבות:</strong> <span style="color:var(--accent-gold); font-size:1.1rem; font-weight:bold;">${rt}</span> 
                        <span style="font-size:0.85rem; color:var(--text-muted);">(גימטריה: ${rtScore} | פסוקים זהים: ${rtExact} | אנגרמה: ${rtAnagramMatch})</span>
                    </div>
                    ${rt ? `<button type="button" class="category-tab" onclick="window.copyPlainText('${rt}', this);" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; cursor: pointer; color: var(--accent-gold); border-color: var(--border-gold);"><i class="fa-solid fa-copy"></i> העתק</button>` : ''}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <strong>סופי תיבות:</strong> <span style="color:var(--accent-gold); font-size:1.1rem; font-weight:bold;">${st}</span> 
                        <span style="font-size:0.85rem; color:var(--text-muted);">(גימטריה: ${stScore} | פסוקים זהים: ${stExact} | אנגרמה: ${stAnagramMatch})</span>
                    </div>
                    ${st ? `<button type="button" class="category-tab" onclick="window.copyPlainText('${st}', this);" style="padding: 0.15rem 0.5rem; font-size: 0.75rem; cursor: pointer; color: var(--accent-gold); border-color: var(--border-gold);"><i class="fa-solid fa-copy"></i> העתק</button>` : ''}
                </div>
            </div>
        </div>
    `;
    box.style.display = 'block';
}

// --- View 11: Unified Verse Analysis ---
function initUnifiedAnalysis() {
    const input = document.getElementById('uva-input');
    const resultsContainer = document.getElementById('uva-results');
    if (!input || !resultsContainer) return;

    // Local RT/ST helpers
    const sofitMap = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
    function toRegularLetter(ch) { return sofitMap[ch] || ch; }
    function getRasheiLocal(txt) {
        const clean = txt
            .replace(/[\u0591-\u05C7]/g, '')
            .replace(/[\u05BE\u05F3\u05F4\u200D\u200C]/g, ' ')
            .replace(/[^\u05D0-\u05EA\s]/g, '')
            .replace(/\s+/g, ' ').trim();
        return clean ? clean.split(' ').filter(w => w.length > 0).map(w => w[0]).join('') : '';
    }
    function getSofeiLocal(txt) {
        const clean = txt
            .replace(/[\u0591-\u05C7]/g, '')
            .replace(/[\u05BE\u05F3\u05F4\u200D\u200C]/g, ' ')
            .replace(/[^\u05D0-\u05EA\s]/g, '')
            .replace(/\s+/g, ' ').trim();
        return clean ? clean.split(' ').filter(w => w.length > 0).map(w => toRegularLetter(w[w.length - 1])).join('') : '';
    }
    function sortLettersLocal(str) { return str.split('').sort().join(''); }
    function ensureCacheLocal() {
        const CACHE_VER = 2;
        if (State.rtCache && State.rtCache.length === State.tanakhVerses.length && State.rtCacheVersion === CACHE_VER) return;
        State.rtCacheVersion = CACHE_VER;
        State.rtCache = State.tanakhVerses.map(v => {
            const r = getRasheiLocal(v.originalText);
            const s = getSofeiLocal(v.originalText);
            return {
                verse: v,
                rashei: r,
                sofei: s,
                rasheiSorted: sortLettersLocal(r),
                sofeiSorted: sortLettersLocal(s),
                rasheiGematria: calculateGematria(r),
                sofeiGematria: calculateGematria(s)
            };
        });
    }

    // Detail Panel Helpers
    window.showUvaDetailVerseByCoord = function(bookHeb, chapter, verse) {
        const v = State.tanakhVerses.find(x => x.bookHeb === bookHeb && x.chapter === chapter && x.verse === verse);
        if (v) {
            showUvaDetailVerse(v);
        }
    };

    function showUvaDetailVerse(v) {
        const panel = document.getElementById('uva-detail-panel');
        const titleEl = document.getElementById('uva-detail-title');
        const contentEl = document.getElementById('uva-detail-content');
        if (!panel || !titleEl || !contentEl) return;

        const sourceText = `${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)}`;
        const versePlain = v.originalText || v.verseText;
        titleEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span><i class="fa-solid fa-book-open"></i> פירוט לפסוק: ${sourceText}</span>
                <button type="button" class="category-tab uva-detail-copy-btn" style="padding: 0.2rem 0.6rem; font-size: 0.8rem; cursor: pointer; color: var(--accent-gold); border-color: var(--border-gold);">
                    <i class="fa-solid fa-copy"></i> העתק
                </button>
            </div>
        `;
        const uvaCopyBtn = titleEl.querySelector('.uva-detail-copy-btn');
        if (uvaCopyBtn) {
            uvaCopyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.copyPlainText(`${versePlain} (${sourceText})`, uvaCopyBtn);
            });
        }

        const insight = findInsightByCoordinate(v.bookHeb, v.chapter, v.verse);
        let innerHtml = `
            <div style="font-family: var(--font-serif); font-size: 1.45rem; line-height: 1.8; text-align: center; margin-bottom: 1.5rem; padding: 1rem; border-right: 3px solid var(--border-gold); background: rgba(var(--accent-gold-rgb), 0.03); color: var(--text-primary);">
                ${v.originalText || v.verseText}
            </div>
            <div style="font-size: 0.95rem; color: var(--text-muted); text-align: center; margin-bottom: 2rem;">
                גימטריה של הפסוק: <strong style="color: var(--accent-gold); font-size: 1.1rem;">${v.gematria || calculateGematria(v.originalText)}</strong>
            </div>
        `;

        if (insight) {
            innerHtml += `
                <div style="border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; flex-wrap: wrap;">
                        <h4 style="font-size: 1.5rem; color: var(--text-primary); margin: 0;">${insight.title || 'ביאור לפסוק'}</h4>
                        <span style="font-size: 0.9rem; color: var(--text-muted);">נכתב ע"י: <strong>${insight.author || 'מחבר'}</strong> | קטגוריה: <strong>${insight.category || 'תורה'}</strong></span>
                    </div>
                    
                    <div style="display: flex; flex-direction: column; gap: 1.5rem; margin-top: 1.5rem; color: var(--text-primary);">
                        ${insight.peshat ? `<div><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;">[פ] פשט:</strong><div style="font-family:var(--font-serif); font-size:1.15rem; line-height:1.7;">${insight.peshat}</div></div>` : ''}
                        ${insight.derash ? `<div><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;">[ד] דרש:</strong><div style="font-family:var(--font-serif); font-size:1.15rem; line-height:1.7;">${insight.derash}</div></div>` : ''}
                        ${insight.remez ? `<div><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;">[ר] רמז:</strong><div style="font-family:var(--font-serif); font-size:1.15rem; line-height:1.7;">${insight.remez}</div></div>` : ''}
                        ${insight.sod ? `<div><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;">[ס] סוד:</strong><div style="font-family:var(--font-serif); font-size:1.15rem; line-height:1.7;">${insight.sod}</div></div>` : ''}
                        ${insight.general ? `<div><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;">ביאור כללי:</strong><div style="font-family:var(--font-serif); font-size:1.15rem; line-height:1.7;">${insight.general}</div></div>` : ''}
                        ${insight.toda ? `<div style="background: rgba(var(--accent-gold-rgb), 0.05); padding: 1rem; border-radius: var(--border-radius-sm); border: 1px dashed var(--border-gold);"><strong style="color:var(--accent-gold); display:block; margin-bottom:0.25rem;"><i class="fa-solid fa-scroll"></i> תודה ה':</strong><div style="font-family:var(--font-serif); font-size:1.1rem; line-height:1.6; font-style:italic;">${insight.toda}</div></div>` : ''}
                    </div>
                </div>
            `;
        } else {
            innerHtml += `
                <div style="text-align: center; padding: 2rem 0; color: var(--text-muted);">
                    <i class="fa-solid fa-pen-fancy" style="font-size: 2rem; color: var(--border-gold); margin-bottom: 1rem; display: block;"></i>
                    <p style="font-size: 1.1rem; margin-bottom: 0.75rem;">לא נכתב עדיין פירוש לפסוק זה במערכת.</p>
                    <button onclick="document.getElementById('edit-verse').value='${v.bookHeb} ${v.chapter}, ${v.verse}'; document.getElementById('edit-verse').dispatchEvent(new Event('blur')); switchView('scribe-desk-view'); document.querySelectorAll('.nav-link').forEach(link => { if (link.getAttribute('data-target')==='scribe-desk-view') link.classList.add('active'); else link.classList.remove('active'); });" class="primary-btn" style="padding: 0.5rem 1.25rem; font-size: 0.95rem;"><i class="fa-solid fa-feather"></i> כתוב חידוש לפסוק זה</button>
                </div>
            `;
        }

        contentEl.innerHTML = innerHtml;
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth' });
    }

    window.showUvaDetailQuery = function showUvaDetailQuery(query) {
        const panel = document.getElementById('uva-detail-panel');
        const titleEl = document.getElementById('uva-detail-title');
        const contentEl = document.getElementById('uva-detail-content');
        if (!panel || !titleEl || !contentEl) return;

        titleEl.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> פסוקים המכילים את הביטוי: "${query}"`;

        const cleanQuery = stripNikud(query).replace(/[^א-ת\s]/g, "");
        const regex = new RegExp('(^|[^א-ת])' + cleanQuery + '($|[^א-ת])');
        const matches = State.tanakhVerses.filter(v => regex.test(v.cleanText));

        if (matches.length === 0) {
            contentEl.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:2rem 0;">לא נמצאו פסוקים המכילים ביטוי זה.</div>`;
        } else {
            let innerHtml = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem; border-bottom:1px solid var(--border-color); padding-bottom:0.4rem;">
                    <span style="font-size:0.95rem; color:var(--text-muted);">
                        נמצאו <strong>${matches.length}</strong> פסוקים (מציג עד 50):
                    </span>
                    <button type="button" class="category-tab uva-query-copy-btn" style="padding:0.25rem 0.65rem; font-size:0.82rem; color:var(--accent-gold); border-color:var(--border-gold); cursor:pointer;">
                        <i class="fa-solid fa-copy"></i> העתק פסוקים
                    </button>
                </div>
                <div style="max-height:400px; overflow-y:auto; display:flex; flex-direction:column; gap:0.6rem;">
            `;

            const limit = 50;
            const display = matches.slice(0, limit);
            display.forEach(match => {
                const sourceLabel = `(${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)})`;
                innerHtml += `
                    <div class="uva-sub-verse-item" style="padding:0.5rem; border-bottom:1px solid var(--border-color); cursor:pointer; transition:all 0.2s; font-family:var(--font-serif); font-size:1.15rem; color:var(--text-primary);" onclick="showUvaDetailVerseByCoord('${match.bookHeb}', ${match.chapter}, ${match.verse})">
                        ${match.originalText} <span style="color:var(--accent-gold); font-size:0.9rem; font-family:var(--font-sans); margin-right:0.25rem;">${sourceLabel}</span>
                    </div>
                `;
            });

            innerHtml += `</div>`;
            contentEl.innerHTML = innerHtml;

            const copyQueryBtn = contentEl.querySelector('.uva-query-copy-btn');
            if (copyQueryBtn) {
                copyQueryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const plainLines = matches.map(m => `${m.originalText} (${m.bookHeb} פרק ${numberToHebrew(m.chapter)} פסוק ${numberToHebrew(m.verse)})`);
                    window.copyPlainText(plainLines.join('\n'), copyQueryBtn);
                });
            }

            // Apply hover styles dynamically for the items
            contentEl.querySelectorAll('.uva-sub-verse-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(var(--accent-gold-rgb), 0.05)';
                    item.style.color = 'var(--accent-gold)';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = '';
                    item.style.color = '';
                });
            });
        }

        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth' });
    }

    // Helper to render matched verses lists in RT panel
    function renderRTMatches(containerId, list) {
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        if (list.length === 0) {
            container.innerHTML = `<div style="color:var(--text-muted); font-size:0.95rem; text-align:center; padding:0.5rem 0;">לא נמצאו.</div>`;
            return;
        }

        const topBar = document.createElement('div');
        topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.4rem;';

        const limit = 50;
        const note = document.createElement('div');
        note.style.cssText = 'color: var(--accent-gold); font-weight: bold; font-size: 0.85rem;';
        note.innerText = list.length > limit ? `מציג 50 מתוך ${list.length}:` : `נמצאו ${list.length}:`;
        topBar.appendChild(note);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'category-tab';
        copyBtn.style.cssText = 'padding: 0.2rem 0.55rem; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.3rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const plainLines = list.map(item => {
                const v = item.verse || item;
                const src = `(${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)})`;
                return `${v.originalText} ${src}`;
            });
            window.copyPlainText(plainLines.join('\n'), copyBtn);
        });
        topBar.appendChild(copyBtn);
        container.appendChild(topBar);

        const display = list.slice(0, limit);
        display.forEach(item => {
            const v = item.verse || item;
            const div = document.createElement('div');
            div.style.cssText = 'cursor: pointer; padding: 0.35rem 0; border-bottom: 1px solid var(--border-color); transition: color 0.2s;';
            div.addEventListener('mouseenter', () => { div.style.color = 'var(--accent-gold)'; });
            div.addEventListener('mouseleave', () => { div.style.color = ''; });
            div.addEventListener('click', () => {
                showUvaDetailVerseByCoord(v.bookHeb, v.chapter, v.verse);
            });
            const sourceLabel = `(${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)})`;
            div.innerHTML = `${v.originalText} <span style="color: var(--accent-gold); font-size: 0.85rem; font-family: var(--font-sans);">${sourceLabel}</span>`;
            container.appendChild(div);
        });
    }

    // Helper to generate and check word repetitions
    function populateNgrams(containerId, list) {
        const container = document.getElementById(containerId);
        container.innerHTML = "";
        if (list.length === 0) {
            container.innerHTML = `<span style="color: var(--text-muted); font-size: 0.9rem;">אין מספיק מילים.</span>`;
            return;
        }
        list.forEach(gram => {
            const regex = new RegExp('(^|[^א-ת])' + gram + '($|[^א-ת])');
            const count = State.tanakhVerses.filter(v => regex.test(v.cleanText)).length;
            
            const span = document.createElement('span');
            span.style.cssText = "cursor:pointer; padding:0.25rem 0.5rem; border-radius:var(--border-radius-sm); transition:all 0.2s; font-size:0.95rem; display:inline-block; margin:0.15rem;";
            
            if (count >= 2 && count <= 6) {
                span.style.background = '#ffe3e3';
                span.style.border = '2px solid #ff8787';
                span.style.fontWeight = '900';
                span.style.color = '#c92a2a';
            } else {
                span.style.background = 'var(--bg-secondary)';
                span.style.border = '1px solid var(--border-gold)';
            }
            
            span.innerHTML = `${gram} <span style="font-weight:bold;">(${count})</span>`;
            span.addEventListener('click', () => {
                showUvaDetailQuery(gram);
            });
            container.appendChild(span);
        });
    }

    // Tab switching inside RT column
    const tabs = document.querySelectorAll('.uva-rt-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-uva-rt-tab');
            document.querySelectorAll('.uva-rt-panel').forEach(panel => {
                panel.style.display = 'none';
            });
            const targetPanel = document.getElementById('uva-rt-panel-' + target);
            if (targetPanel) targetPanel.style.display = 'block';
        });
    });

    // Copy buttons for Unified Analysis Rashei & Sofei boxes
    const uvaCopyRasheiBtn = document.getElementById('uva-rt-copy-rashei-btn');
    if (uvaCopyRasheiBtn) {
        uvaCopyRasheiBtn.addEventListener('click', () => {
            const txt = document.getElementById('uva-rt-rashei').textContent.trim();
            window.copyPlainText(txt, uvaCopyRasheiBtn);
        });
    }

    const uvaCopySofeiBtn = document.getElementById('uva-rt-copy-sofei-btn');
    if (uvaCopySofeiBtn) {
        uvaCopySofeiBtn.addEventListener('click', () => {
            const txt = document.getElementById('uva-rt-sofei').textContent.trim();
            window.copyPlainText(txt, uvaCopySofeiBtn);
        });
    }

    let uvaDebounce = null;
    input.addEventListener('input', () => {
        const val = input.value.trim();
        
        // Sync shared verse
        State.sharedVerse = val;
        localStorage.setItem('torah_shared_verse', val);

        clearTimeout(uvaDebounce);
        uvaDebounce = setTimeout(() => {
            if (!val) {
                resultsContainer.style.display = 'none';
                document.getElementById('uva-detail-panel').style.display = 'none';
                return;
            }
            
            addToHistory('unified', val);
            
            resultsContainer.style.display = 'block';

            // --- 1. GEMATRIA ---
            const score = calculateGematria(val);
            document.getElementById('uva-gem-total').textContent = score;
            document.getElementById('uva-gem-heb').textContent = `בגימטריה: ${numberToHebrew(score)}`;

            // Word-by-word pills
            const cleanText = stripNikud(val).replace(/[^א-ת\s]/g, "").replace(/\s+/g, " ").trim();
            const uvaGemWords = document.getElementById('uva-gem-words');
            uvaGemWords.innerHTML = "";
            if (cleanText) {
                const words = cleanText.split(' ');
                words.forEach(word => {
                    if (!word) return;
                    const scoreWord = calculateGematria(word);
                    const matchCount = State.tanakhVerses.filter(v => v.gematria === scoreWord).length;
                    
                    const totalDigits = new Set(String(score).split(''));
                    const wordDigits = String(scoreWord).split('');
                    const isDigitSubset = scoreWord > 0 && wordDigits.every(d => totalDigits.has(d));
                    
                    const span = document.createElement('span');
                    span.style.cssText = "cursor:pointer; padding:0.3rem 0.6rem; border:1px solid var(--border-gold); border-radius:var(--border-radius-sm); font-size:1.05rem; transition:all 0.2s; display:inline-block; margin:0.15rem;";
                    if (isDigitSubset) {
                        span.style.background = 'rgba(var(--accent-gold-rgb), 0.18)';
                        span.style.borderColor = 'var(--accent-gold)';
                        span.style.boxShadow = '0 0 6px rgba(var(--accent-gold-rgb), 0.35)';
                        span.title = `ספרות ${scoreWord} כלולות בספרות ${score}`;
                    } else {
                        span.style.background = 'var(--bg-secondary)';
                    }
                    const badge = isDigitSubset ? ' <span style="font-size:0.75rem; background: var(--accent-gold); color: #1a1a2e; border-radius: 4px; padding: 0.05rem 0.3rem; font-weight: bold; vertical-align: middle;">✦</span>' : '';
                    span.innerHTML = `${word} = ${scoreWord}${badge} <span style="color:var(--accent-gold); font-weight:bold;">(${matchCount})</span>`;
                    
                    span.addEventListener('click', () => {
                        showUvaDetailQuery(word);
                    });
                    uvaGemWords.appendChild(span);
                });
            }

            // Matching verses
            const uvaGemMatches = document.getElementById('uva-gem-matches');
            uvaGemMatches.innerHTML = "";
            const gemMatches = State.tanakhVerses.filter(v => v.gematria === score);
            document.getElementById('uva-gem-count').textContent = gemMatches.length;
            if (gemMatches.length > 0) {
                const topBar = document.createElement('div');
                topBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; gap: 0.4rem;';

                const limit = 50;
                const note = document.createElement('div');
                note.style.cssText = 'color: var(--accent-gold); font-weight: bold; font-size: 0.85rem;';
                note.innerText = gemMatches.length > limit ? `מציג 50 מתוך ${gemMatches.length}:` : `נמצאו ${gemMatches.length}:`;
                topBar.appendChild(note);

                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'category-tab';
                copyBtn.style.cssText = 'padding: 0.2rem 0.55rem; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 0.3rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;';
                copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> העתק';
                copyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const plainLines = gemMatches.map(m => `${m.originalText} (${m.bookHeb} פרק ${numberToHebrew(m.chapter)} פסוק ${numberToHebrew(m.verse)})`);
                    window.copyPlainText(plainLines.join('\n'), copyBtn);
                });
                topBar.appendChild(copyBtn);
                uvaGemMatches.appendChild(topBar);

                const displayMatches = gemMatches.slice(0, limit);
                displayMatches.forEach(match => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding: 0.4rem 0; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: color 0.2s;';
                    div.addEventListener('mouseenter', () => { div.style.color = 'var(--accent-gold)'; });
                    div.addEventListener('mouseleave', () => { div.style.color = ''; });
                    
                    const sourceLabel = `(${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)})`;
                    div.innerHTML = `${match.originalText} <span style="color: var(--accent-gold); font-size: 0.85rem; font-family: var(--font-sans);">${sourceLabel}</span>`;
                    
                    div.addEventListener('click', () => {
                        showUvaDetailVerseByCoord(match.bookHeb, match.chapter, match.verse);
                    });
                    uvaGemMatches.appendChild(div);
                });
            } else {
                uvaGemMatches.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 0.5rem 0;">אין פסוקים זהים.</div>';
            }

            // --- 2. WORD REPETITION ---
            if (cleanText) {
                const words = cleanText.split(' ').filter(w => w.length > 0);
                
                // Singles
                populateNgrams('uva-rep-words', words);

                // Pairs
                const pairs = [];
                for (let i = 0; i < words.length - 1; i++) {
                    pairs.push(words[i] + " " + words[i+1]);
                }
                populateNgrams('uva-rep-pairs', pairs);

                // Triplets
                const triplets = [];
                for (let i = 0; i < words.length - 2; i++) {
                    triplets.push(words[i] + " " + words[i+1] + " " + words[i+2]);
                }
                populateNgrams('uva-rep-triplets', triplets);

                // Quads
                const quads = [];
                for (let i = 0; i < words.length - 3; i++) {
                    quads.push(words[i] + " " + words[i+1] + " " + words[i+2] + " " + words[i+3]);
                }
                populateNgrams('uva-rep-quads', quads);
            }

            // --- 3. RASHEI & SOFEI TEIVOT ---
            const rashei = getRasheiLocal(val);
            const sofei = getSofeiLocal(val);

            document.getElementById('uva-rt-rashei').textContent = rashei || '-';
            const rasheiGem = rashei ? calculateGematria(rashei) : 0;
            document.getElementById('uva-rt-rashei-gem').textContent = rasheiGem;

            document.getElementById('uva-rt-sofei').textContent = sofei || '-';
            const sofeiGem = sofei ? calculateGematria(sofei) : 0;
            document.getElementById('uva-rt-sofei-gem').textContent = sofeiGem;

            if (rashei || sofei) {
                ensureCacheLocal();

                // Exact Rashei
                const exactRashei = State.rtCache.filter(c => c.rashei === rashei);
                document.getElementById('uva-rt-cnt-er').textContent = `(${exactRashei.length})`;
                renderRTMatches('uva-rt-panel-exact-rashei', exactRashei);

                // Exact Sofei
                const exactSofei = State.rtCache.filter(c => c.sofei === sofei);
                document.getElementById('uva-rt-cnt-es').textContent = `(${exactSofei.length})`;
                renderRTMatches('uva-rt-panel-exact-sofei', exactSofei);

                // Anagram Rashei
                const rasheiSorted = sortLettersLocal(rashei);
                const anagramRashei = State.rtCache.filter(c => c.rasheiSorted === rasheiSorted && c.rashei !== rashei);
                const cntAr = document.getElementById('uva-rt-cnt-ar');
                if (cntAr) cntAr.textContent = `(${anagramRashei.length})`;
                renderRTMatches('uva-rt-panel-anagram-rashei', anagramRashei);

                // Anagram Sofei
                const sofeiSorted = sortLettersLocal(sofei);
                const anagramSofei = State.rtCache.filter(c => c.sofeiSorted === sofeiSorted && c.sofei !== sofei);
                const cntAs = document.getElementById('uva-rt-cnt-as');
                if (cntAs) cntAs.textContent = `(${anagramSofei.length})`;
                renderRTMatches('uva-rt-panel-anagram-sofei', anagramSofei);

                // Gematria Rashei
                const gemRashei = State.rtCache.filter(c => c.rasheiGematria === rasheiGem);
                document.getElementById('uva-rt-cnt-gr').textContent = `(${gemRashei.length})`;
                renderRTMatches('uva-rt-panel-gem-rashei', gemRashei);

                // Gematria Sofei
                const gemSofei = State.rtCache.filter(c => c.sofeiGematria === sofeiGem);
                document.getElementById('uva-rt-cnt-gs').textContent = `(${gemSofei.length})`;
                renderRTMatches('uva-rt-panel-gem-sofei', gemSofei);

                // Words Rashei
                const wordsRasheiPanel = document.getElementById('uva-rt-panel-words-rashei');
                if (wordsRasheiPanel) {
                    const cntWr = renderWordsAnagramList(wordsRasheiPanel, rashei);
                    const cntWrEl = document.getElementById('uva-rt-cnt-wr');
                    if (cntWrEl) cntWrEl.textContent = `(${cntWr})`;
                }

                // Words Sofei
                const wordsSofeiPanel = document.getElementById('uva-rt-panel-words-sofei');
                if (wordsSofeiPanel) {
                    const cntWs = renderWordsAnagramList(wordsSofeiPanel, sofei);
                    const cntWsEl = document.getElementById('uva-rt-cnt-ws');
                    if (cntWsEl) cntWsEl.textContent = `(${cntWs})`;
                }
            }

        }, 400);
    });
}

// --- History & Shared Verse Helpers ---
function addToHistory(type, query) {
    if (!query) return;
    const cleanQuery = query.trim();
    if (!cleanQuery) return;
    
    if (!State.searchHistory) {
        State.searchHistory = { gematria: [], wordRep: [], rashei: [], unified: [], anagram: [] };
    }
    if (!State.searchHistory[type]) {
        State.searchHistory[type] = [];
    }
    
    // Remove if already exists to put it at top
    State.searchHistory[type] = State.searchHistory[type].filter(item => item !== cleanQuery);
    
    // Insert at front
    State.searchHistory[type].unshift(cleanQuery);
    
    // Limit to 10
    if (State.searchHistory[type].length > 10) {
        State.searchHistory[type] = State.searchHistory[type].slice(0, 10);
    }
    
    localStorage.setItem('torah_search_history', JSON.stringify(State.searchHistory));
    
    // Re-render
    let listId = '';
    if (type === 'gematria') listId = 'gematria-history-list';
    else if (type === 'wordRep') listId = 'word-rep-history-list';
    else if (type === 'rashei') listId = 'rashei-history-list';
    else if (type === 'unified') listId = 'unified-history-list';
    else if (type === 'anagram') listId = 'anagram-history-list';
    
    renderHistoryPanel(type, listId);
}

function renderHistoryPanel(type, listId) {
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    
    listEl.innerHTML = '';
    const history = (State.searchHistory && State.searchHistory[type]) ? State.searchHistory[type] : [];
    
    if (history.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem; text-align: center;">אין היסטוריה.</div>';
        return;
    }
    
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.textContent = item;
        div.title = item;
        div.addEventListener('click', () => {
            // Update shared verse and trigger input
            State.sharedVerse = item;
            localStorage.setItem('torah_shared_verse', item);
            
            let inputId = '';
            if (type === 'gematria') inputId = 'calc-input';
            else if (type === 'wordRep') inputId = 'verse-analysis-input';
            else if (type === 'rashei') inputId = 'rt-input';
            else if (type === 'unified') inputId = 'uva-input';
            else if (type === 'anagram') inputId = 'anagram-input';
            
            const inp = document.getElementById(inputId);
            if (inp) {
                inp.value = item;
                inp.dispatchEvent(new Event('input'));
            }
        });
        listEl.appendChild(div);
    });
}

function syncSharedVerseAndRenderHistories(targetId) {
    if (targetId === 'gematria-view') {
        const inp = document.getElementById('calc-input');
        if (inp) {
            if (State.sharedVerse && inp.value !== State.sharedVerse) {
                inp.value = State.sharedVerse;
                inp.dispatchEvent(new Event('input'));
            }
        }
        renderHistoryPanel('gematria', 'gematria-history-list');
    } else if (targetId === 'word-repetition-view') {
        const inp = document.getElementById('verse-analysis-input');
        if (inp) {
            if (State.sharedVerse && inp.value !== State.sharedVerse) {
                inp.value = State.sharedVerse;
                inp.dispatchEvent(new Event('input'));
            }
        }
        renderHistoryPanel('wordRep', 'word-rep-history-list');
    } else if (targetId === 'rashei-teivot-view') {
        const inp = document.getElementById('rt-input');
        if (inp) {
            if (State.sharedVerse && inp.value !== State.sharedVerse) {
                inp.value = State.sharedVerse;
                inp.dispatchEvent(new Event('input'));
            }
        }
        renderHistoryPanel('rashei', 'rashei-history-list');
    } else if (targetId === 'verse-analysis-unified-view') {
        const inp = document.getElementById('uva-input');
        if (inp) {
            if (State.sharedVerse && inp.value !== State.sharedVerse) {
                inp.value = State.sharedVerse;
                inp.dispatchEvent(new Event('input'));
            }
        }
        renderHistoryPanel('unified', 'unified-history-list');
        renderHistoryPanel('anagram', 'anagram-history-list');
    }
}

// --- Anagram / Letter Combination Finder Feature ---
function normalizeHebrewLetters(str) {
    if (!str) return "";
    return str.replace(/ך/g, 'כ')
              .replace(/ם/g, 'מ')
              .replace(/ן/g, 'נ')
              .replace(/ף/g, 'פ')
              .replace(/ץ/g, 'צ');
}

function getHebrewLetterCounts(str) {
    const counts = {};
    const normalized = normalizeHebrewLetters(stripNikud(str)).replace(/[^א-ת]/g, "");
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        counts[char] = (counts[char] || 0) + 1;
    }
    return counts;
}

function canFormWordFromCounts(wordCounts, availableCounts) {
    for (let letter in wordCounts) {
        if (!availableCounts[letter] || wordCounts[letter] > availableCounts[letter]) {
            return false;
        }
    }
    return true;
}

function ensureTanakhWordCorpus() {
    if (State.tanakhWordCorpus && State.tanakhWordCorpus.length > 0) {
        return State.tanakhWordCorpus;
    }
    if (!State.tanakhVerses || State.tanakhVerses.length === 0) {
        return [];
    }

    console.time("Building Tanakh Word Corpus");
    const wordFreqMap = {};
    
    State.tanakhVerses.forEach(v => {
        const cleanText = stripNikud(v.originalText).replace(/[^א-ת\s]/g, "").replace(/\s+/g, " ").trim();
        if (!cleanText) return;
        const words = cleanText.split(' ');
        words.forEach(w => {
            if (w.length >= 3) {
                wordFreqMap[w] = (wordFreqMap[w] || 0) + 1;
            }
        });
    });

    const corpus = [];
    for (let word in wordFreqMap) {
        const normCounts = getHebrewLetterCounts(word);
        corpus.push({
            word: word,
            count: wordFreqMap[word],
            length: word.length,
            normCounts: normCounts
        });
    }

    State.tanakhWordCorpus = corpus;
    console.timeEnd("Building Tanakh Word Corpus");
    console.log(`Indexed ${corpus.length} unique 3+ letter words from Tanakh.`);
    return corpus;
}

function initAnagramFinder() {
    const input = document.getElementById('anagram-input');
    const searchBtn = document.getElementById('anagram-search-btn');
    const summaryBar = document.getElementById('anagram-summary-bar');
    const resultsContainer = document.getElementById('anagram-results-container');
    const lengthGroupsContainer = document.getElementById('anagram-length-groups');
    const totalWordsEl = document.getElementById('anagram-total-words');
    const maxLengthEl = document.getElementById('anagram-max-length');
    const breakdownEl = document.getElementById('anagram-letters-breakdown');

    if (!input) return;

    function runAnagramSearch() {
        const rawInput = input.value.trim();

        if (!rawInput) {
            summaryBar.style.display = 'none';
            resultsContainer.style.display = 'none';
            return;
        }


        // Clean input letters: keep Hebrew letters only
        const cleanLetters = stripNikud(rawInput).replace(/[^א-ת]/g, "");
        if (cleanLetters.length < 3) {
            summaryBar.style.display = 'block';
            totalWordsEl.textContent = "0";
            maxLengthEl.textContent = "0";
            breakdownEl.innerHTML = `<span style="color: var(--text-muted);">נא להזין לפחות 3 אותיות בעברית.</span>`;
            resultsContainer.style.display = 'none';
            return;
        }

        // Add to history
        addToHistory('anagram', rawInput);

        // 1. Get input letter counts
        const inputCounts = getHebrewLetterCounts(cleanLetters);
        const totalInputLetters = Object.values(inputCounts).reduce((a, b) => a + b, 0);

        // Render letter breakdown
        breakdownEl.innerHTML = "";
        for (let letter in inputCounts) {
            const badge = document.createElement('span');
            badge.style.cssText = "background: var(--bg-primary); border: 1px solid var(--border-gold); padding: 0.2rem 0.6rem; border-radius: var(--border-radius-sm); color: var(--text-primary);";
            badge.innerHTML = `<strong>${letter}</strong>: ${inputCounts[letter]}`;
            breakdownEl.appendChild(badge);
        }

        // 2. Ensure corpus and filter matches
        const corpus = ensureTanakhWordCorpus();
        const matchingWords = [];

        for (let item of corpus) {
            if (item.length <= totalInputLetters && item.length >= 3) {
                if (canFormWordFromCounts(item.normCounts, inputCounts)) {
                    matchingWords.push(item);
                }
            }
        }

        if (matchingWords.length === 0) {
            summaryBar.style.display = 'block';
            totalWordsEl.textContent = "0";
            maxLengthEl.textContent = "0";
            resultsContainer.style.display = 'block';
            lengthGroupsContainer.innerHTML = `
                <div class="empty-state" style="padding: 2.5rem; text-align: center; background: var(--bg-secondary); border-radius: var(--border-radius-md); border: 1px solid var(--border-color);">
                    <p style="font-size: 1.1rem; color: var(--text-muted); margin: 0;">
                        לא נמצאו מילים במאגר התנ"ך בנות 3 אותיות ומעלה שניתן להרכיב מאותיות אלו.
                    </p>
                </div>
            `;
            return;
        }

        // 3. Group matching words by length
        const groupsByLength = {};
        let maxWordLen = 0;

        matchingWords.forEach(item => {
            if (!groupsByLength[item.length]) {
                groupsByLength[item.length] = [];
            }
            groupsByLength[item.length].push(item);
            if (item.length > maxWordLen) {
                maxWordLen = item.length;
            }
        });

        // Update summary
        summaryBar.style.display = 'block';
        totalWordsEl.textContent = matchingWords.length.toLocaleString('he-IL');
        maxLengthEl.textContent = maxWordLen;

        // 4. Render groups
        lengthGroupsContainer.innerHTML = "";

        // Add legend at top of length groups
        const legendDiv = document.createElement('div');
        legendDiv.innerHTML = getAnagramLegendHtml();
        lengthGroupsContainer.appendChild(legendDiv.firstElementChild);

        let sortMode = State.anagramSortMode || 'length';

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'anagram-sort-controls';
        controlsDiv.style.cssText = "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; background: var(--bg-primary); border: 1px solid var(--border-gold); padding: 0.5rem 0.9rem; border-radius: var(--border-radius-sm);";
        
        controlsDiv.innerHTML = `
            <div style="font-weight: bold; color: var(--accent-gold); font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                <i class="fa-solid fa-arrow-down-a-z"></i> תצוגת סידור:
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center;">
                <button type="button" class="category-tab anagram-sort-btn-len ${sortMode === 'length' ? 'active' : ''}" style="padding: 0.25rem 0.75rem; font-size: 0.85rem;">
                    <i class="fa-solid fa-text-width"></i> לפי כמות אותיות
                </button>
                <button type="button" class="category-tab anagram-sort-btn-cat ${sortMode === 'category' ? 'active' : ''}" style="padding: 0.25rem 0.75rem; font-size: 0.85rem;">
                    <i class="fa-solid fa-palette"></i> לפי קטגוריות
                </button>
                <button type="button" class="category-tab anagram-copy-btn" style="padding: 0.25rem 0.75rem; font-size: 0.85rem; color: var(--accent-gold); border-color: var(--border-gold); margin-right: 0.35rem; cursor: pointer;">
                    <i class="fa-solid fa-copy"></i> העתק תוצאות
                </button>
            </div>
        `;
        lengthGroupsContainer.appendChild(controlsDiv);

        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'anagram-cards-container';
        lengthGroupsContainer.appendChild(cardsContainer);

        function onAnagramFinderPillClick(item) {
            const panel = document.getElementById('anagram-detail-panel');
            const titleEl = document.getElementById('anagram-detail-title');
            const contentEl = document.getElementById('anagram-detail-content');
            if (!panel || !titleEl || !contentEl) return;

            titleEl.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> פסוקים המכילים את המילה: <strong>${item.word}</strong> (${item.count} מופעים)`;

            const regex = new RegExp('(^|[^א-ת])' + item.word + '($|[^א-ת])');
            const matches = State.tanakhVerses.filter(v => regex.test(v.cleanText));

            if (matches.length === 0) {
                contentEl.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:1rem;">לא נמצאו פסוקים.</div>`;
            } else {
                const limit = 50;
                let html = `<div style="font-size:0.9rem; color:var(--text-muted); margin-bottom:0.75rem;">מציג ${Math.min(matches.length, limit)} מתוך ${matches.length} פסוקים:</div>`;
                matches.slice(0, limit).forEach(v => {
                    const srcLabel = `(${v.bookHeb} פרק ${numberToHebrew(v.chapter)} פסוק ${numberToHebrew(v.verse)})`;
                    html += `<div style="padding:0.4rem 0; border-bottom:1px solid var(--border-color);">${v.originalText} <span style="color:var(--accent-gold); font-size:0.85rem; font-family:var(--font-sans);">${srcLabel}</span></div>`;
                });
                contentEl.innerHTML = html;
            }

            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function updateFinderView() {
            controlsDiv.querySelector('.anagram-sort-btn-len').classList.toggle('active', sortMode === 'length');
            controlsDiv.querySelector('.anagram-sort-btn-cat').classList.toggle('active', sortMode === 'category');
            renderAnagramCards(cardsContainer, matchingWords, rawInput, sortMode, onAnagramFinderPillClick);
        }

        controlsDiv.querySelector('.anagram-sort-btn-len').addEventListener('click', () => {
            sortMode = 'length';
            State.anagramSortMode = 'length';
            updateFinderView();
        });

        controlsDiv.querySelector('.anagram-sort-btn-cat').addEventListener('click', () => {
            sortMode = 'category';
            State.anagramSortMode = 'category';
            updateFinderView();
        });

        controlsDiv.querySelector('.anagram-copy-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            let plainText = '';
            if (sortMode === 'category') {
                const groupsByCat = {};
                ANAGRAM_CATEGORIES_CONFIG.forEach(c => { groupsByCat[c.key] = []; });
                matchingWords.forEach(it => {
                    const cat = getAnagramCategory(it.word, rawInput);
                    if (!groupsByCat[cat]) groupsByCat[cat] = [];
                    groupsByCat[cat].push(it);
                });
                const sections = [];
                ANAGRAM_CATEGORIES_CONFIG.forEach(catConfig => {
                    const list = groupsByCat[catConfig.key];
                    if (!list || list.length === 0) return;
                    const wordsStr = list.map(w => `${w.word} (${w.count})`).join(', ');
                    sections.push(`${catConfig.name} (${list.length} מילים):\n${wordsStr}`);
                });
                plainText = sections.join('\n\n');
            } else {
                const groupsByLength = {};
                matchingWords.forEach(it => {
                    if (!groupsByLength[it.length]) groupsByLength[it.length] = [];
                    groupsByLength[it.length].push(it);
                });
                const sortedLens = Object.keys(groupsByLength).map(Number).sort((a, b) => b - a);
                const sections = [];
                sortedLens.forEach(l => {
                    const list = groupsByLength[l];
                    const wordsStr = list.map(w => `${w.word} (${w.count})`).join(', ');
                    sections.push(`מילים בנות ${l} אותיות (${list.length} מילים):\n${wordsStr}`);
                });
                plainText = sections.join('\n\n');
            }
            window.copyPlainText(plainText, controlsDiv.querySelector('.anagram-copy-btn'));
        });

        updateFinderView();

        resultsContainer.style.display = 'block';
    }

    let anagramDebounce = null;
    input.addEventListener('input', () => {
        clearTimeout(anagramDebounce);
        anagramDebounce = setTimeout(() => {
            runAnagramSearch();
        }, 400);
    });

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            clearTimeout(anagramDebounce);
            runAnagramSearch();
        });
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(anagramDebounce);
            runAnagramSearch();
        }
    });
}

// --- Multi-Verse / Chapter Gematria Analysis (Book Distribution) ---
function initMultiVerseGematria() {
    const input = document.getElementById('multi-gematria-input');
    const analyzeBtn = document.getElementById('multi-gematria-btn');
    const resultsContainer = document.getElementById('multi-gematria-results');
    const summaryEl = document.getElementById('multi-gematria-summary');
    const booksListEl = document.getElementById('multi-gematria-books-list');
    const sortControls = document.getElementById('multi-gematria-sort-controls');
    const sortCanonicalBtn = document.getElementById('sort-books-canonical');
    const sortCountBtn = document.getElementById('sort-books-count');

    if (!input || !analyzeBtn) return;

    // Chapter Auto-Loader Dropdowns
    const mgBookSelect = document.getElementById('mg-book-select');
    const mgChapterSelect = document.getElementById('mg-chapter-select');
    const mgLoadBtn = document.getElementById('mg-load-chapter-btn');

    if (mgBookSelect && mgChapterSelect && mgLoadBtn) {
        // Populate book dropdown once
        if (mgBookSelect.options.length <= 1 && typeof TanakhData !== 'undefined') {
            const bookOrderMap = [
                ["בראשית","Gen"],["שמות","Exod"],["ויקרא","Lev"],["במדבר","Num"],["דברים","Deut"],
                ["יהושע","Josh"],["שופטים","Judg"],["שמואל א","1Sam"],["שמואל ב","2Sam"],
                ["מלכים א","1Kgs"],["מלכים ב","2Kgs"],["ישעיהו","Isa"],["ירמיהו","Jer"],
                ["יחזקאל","Ezek"],["הושע","Hos"],["יואל","Joel"],["עמוס","Amos"],
                ["עובדיה","Obad"],["יונה","Jonah"],["מיכה","Mic"],["נחום","Nah"],
                ["חבקוק","Hab"],["צפניה","Zeph"],["חגי","Hag"],["זכריה","Zech"],["מלאכי","Mal"],
                ["תהילים","Ps"],["משלי","Prov"],["איוב","Job"],["שיר השירים","Song"],
                ["רות","Ruth"],["איכה","Lam"],["קהלת","Eccl"],["אסתר","Esth"],
                ["דניאל","Dan"],["עזרא","Ezra"],["נחמיה","Neh"],["דברי הימים א","1Chr"],["דברי הימים ב","2Chr"]
            ];
            bookOrderMap.forEach(([heb, rk]) => {
                if (TanakhData[rk]) {
                    const opt = document.createElement('option');
                    opt.value = rk;
                    opt.dataset.heb = heb;
                    opt.textContent = heb;
                    mgBookSelect.appendChild(opt);
                }
            });
        }

        mgBookSelect.addEventListener('change', () => {
            const rk = mgBookSelect.value;
            mgChapterSelect.innerHTML = '<option value="">-- בחר פרק --</option>';
            mgChapterSelect.disabled = true;
            mgLoadBtn.disabled = true;

            if (rk && TanakhData[rk]) {
                const numChapters = TanakhData[rk].length;
                for (let c = 1; c <= numChapters; c++) {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = `פרק ${numberToHebrew(c)}`;
                    mgChapterSelect.appendChild(opt);
                }
                mgChapterSelect.disabled = false;
            }
        });

        mgChapterSelect.addEventListener('change', () => {
            mgLoadBtn.disabled = !mgChapterSelect.value;
        });

        mgLoadBtn.addEventListener('click', () => {
            const rk = mgBookSelect.value;
            const cNum = parseInt(mgChapterSelect.value, 10);
            const selectedOpt = mgBookSelect.options[mgBookSelect.selectedIndex];
            const bookHeb = selectedOpt ? selectedOpt.dataset.heb : '';

            if (!bookHeb || !cNum || !State.tanakhVerses) return;

            // Filter verses for this book and chapter
            const chapterVerses = State.tanakhVerses.filter(v => v.bookHeb === bookHeb && v.chapter === cNum);
            if (chapterVerses.length === 0) return;

            // Extract each verse onto its own line
            const formattedText = chapterVerses.map(v => v.originalText).join('\n');
            input.value = formattedText;

            // Run analysis immediately
            clearTimeout(multiDebounce);
            runAnalysis();
        });
    }

    let currentSortMode = 'canonical'; // 'canonical' or 'count'
    let lastBookStats = null;
    let lastLinesData = null;

    const canonicalBookOrder = [
        "בראשית", "שמות", "ויקרא", "במדבר", "דברים",
        "יהושע", "שופטים", "שמואל א", "שמואל ב", "מלכים א", "מלכים ב",
        "ישעיהו", "ירמיהו", "יחזקאל",
        "הושע", "יואל", "עמוס", "עובדיה", "יונה", "מיכה", "נחום", "חבקוק", "צפניה", "חגי", "זכריה", "מלאכי",
        "תהילים", "משלי", "איוב", "שיר השירים", "רות", "איכה", "קהלת", "אסתר", "דניאל", "עזרא", "נחמיה", "דברי הימים א", "דברי הימים ב"
    ];

    function renderResults() {
        if (!lastBookStats || !lastLinesData || lastLinesData.length === 0) {
            resultsContainer.style.display = 'none';
            sortControls.style.display = 'none';
            return;
        }

        // Calculate totals
        let totalMatchesAll = 0;
        const activeBooks = [];

        for (let bookHeb in lastBookStats) {
            const stats = lastBookStats[bookHeb];
            if (stats.totalMatchesCount > 0) {
                activeBooks.push(stats);
                totalMatchesAll += stats.totalMatchesCount;
            }
        }

        if (activeBooks.length === 0) {
            summaryEl.innerHTML = `
                <div style="text-align: center; color: var(--text-muted);">
                    <p style="margin: 0; font-size: 1.1rem;">נבדקו ${lastLinesData.length} שורות/פסוקים. לא נמצאו פסוקים במאגר בעלי גימטריה זהה.</p>
                </div>
            `;
            booksListEl.innerHTML = "";
            resultsContainer.style.display = 'block';
            sortControls.style.display = 'none';
            return;
        }

        // Sort active books based on sort mode
        if (currentSortMode === 'count') {
            activeBooks.sort((a, b) => b.totalMatchesCount - a.totalMatchesCount);
        } else {
            activeBooks.sort((a, b) => {
                const idxA = canonicalBookOrder.indexOf(a.bookHeb);
                const idxB = canonicalBookOrder.indexOf(b.bookHeb);
                return (idxA !== -1 ? idxA : 999) - (idxB !== -1 ? idxB : 999);
            });
        }

        // Render Summary Box in exact format requested by user
        let summaryRowsHtml = activeBooks.map(b => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.5rem; border-bottom: 1px dashed var(--border-color);">
                <span style="font-weight: bold; color: var(--text-primary);">${b.bookHeb}</span>
                <span style="font-weight: 900; color: var(--accent-gold); font-size: 1.15rem;">${b.totalMatchesCount}</span>
            </div>
        `).join('');

        summaryEl.innerHTML = `
            <div style="margin-bottom: 1rem; border-bottom: 1px solid var(--border-gold); padding-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <strong style="color: var(--accent-gold); font-size: 1.25rem;"><i class="fa-solid fa-chart-line"></i> סיכום התפלגות לפי ספרים</strong>
                    <div style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.2rem;">
                        נבדקו <strong>${lastLinesData.length}</strong> שורות/פסוקים | <strong>${activeBooks.length}</strong> ספרים | סה"כ <strong>${totalMatchesAll}</strong> הקבלות
                    </div>
                </div>
                <button type="button" class="category-tab mg-copy-all-btn" style="padding: 0.3rem 0.8rem; font-size: 0.88rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;">
                    <i class="fa-solid fa-copy"></i> העתק את כל ההקבלות
                </button>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.5rem 1.5rem; font-family: var(--font-sans);">
                ${summaryRowsHtml}
            </div>
        `;

        const copyAllBtn = summaryEl.querySelector('.mg-copy-all-btn');
        if (copyAllBtn) {
            copyAllBtn.addEventListener('click', () => {
                const bookSections = activeBooks.map(b => {
                    const lines = b.verseMatches.map(m => {
                        const src = `(${m.matchedVerse.bookHeb} פרק ${numberToHebrew(m.matchedVerse.chapter)} פסוק ${numberToHebrew(m.matchedVerse.verse)})`;
                        return `[שורה #${m.lineNum}] ${m.matchedVerse.originalText} ${src}`;
                    });
                    return `ספר ${b.bookHeb} (${b.totalMatchesCount} הקבלות):\n` + lines.join('\n');
                });
                window.copyPlainText(`סיכום הקבלות גימטריה לפי ספרים:\n\n` + bookSections.join('\n\n'), copyAllBtn);
            });
        }

        // Render Detailed Expandable Cards per Book
        booksListEl.innerHTML = "";
        activeBooks.forEach(b => {
            const bookCard = document.createElement('div');
            bookCard.className = 'multi-gematria-book-card';
            bookCard.style.cssText = "background: var(--bg-secondary); border: 1px solid var(--border-gold); border-radius: var(--border-radius-md); padding: 1.25rem 1.5rem;";

            const header = document.createElement('div');
            header.style.cssText = "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;";
            header.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <h4 style="margin: 0; color: var(--accent-gold); font-size: 1.2rem;">
                        <i class="fa-solid fa-book"></i> ספר ${b.bookHeb}
                    </h4>
                    <span style="font-size: 0.85rem; background: rgba(var(--accent-gold-rgb), 0.18); color: var(--accent-gold); padding: 0.15rem 0.65rem; border-radius: 12px; font-weight: bold;">
                        ${b.totalMatchesCount} הקבלות
                    </span>
                </div>
                <button type="button" class="category-tab mg-book-copy-btn" style="padding: 0.2rem 0.6rem; font-size: 0.8rem; color: var(--accent-gold); border-color: var(--border-gold); cursor: pointer;">
                    <i class="fa-solid fa-copy"></i> העתק
                </button>
            `;

            const copyBookBtn = header.querySelector('.mg-book-copy-btn');
            if (copyBookBtn) {
                copyBookBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const lines = b.verseMatches.map(m => {
                        const src = `(${m.matchedVerse.bookHeb} פרק ${numberToHebrew(m.matchedVerse.chapter)} פסוק ${numberToHebrew(m.matchedVerse.verse)})`;
                        return `[שורה #${m.lineNum}] ${m.matchedVerse.originalText} ${src}`;
                    });
                    window.copyPlainText(`ספר ${b.bookHeb} (${b.totalMatchesCount} הקבלות):\n` + lines.join('\n'), copyBookBtn);
                });
            }

            const detailsList = document.createElement('div');
            detailsList.style.cssText = "margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; font-family: var(--font-serif); font-size: 1.15rem; line-height: 1.6;";

            b.verseMatches.forEach(matchInfo => {
                const item = document.createElement('div');
                item.style.cssText = "cursor: pointer; padding: 0.4rem 0; border-bottom: 1px solid var(--border-color); transition: color 0.2s;";
                item.addEventListener('mouseenter', () => { item.style.color = 'var(--accent-gold)'; });
                item.addEventListener('mouseleave', () => { item.style.color = ''; });

                const insightMatch = findInsightByCoordinate(matchInfo.matchedVerse.bookHeb, matchInfo.matchedVerse.chapter, matchInfo.matchedVerse.verse);

                if (insightMatch) {
                    item.addEventListener('click', () => {
                        openInsightReader(insightMatch.id);
                        switchView('insight-reader-view');
                    });
                } else {
                    item.addEventListener('click', () => {
                        document.getElementById('edit-verse').value = `${matchInfo.matchedVerse.bookHeb} ${matchInfo.matchedVerse.chapter}, ${matchInfo.matchedVerse.verse}`;
                        document.getElementById('edit-verse').dispatchEvent(new Event('blur'));
                        switchView('scribe-desk-view');
                        document.querySelectorAll('.nav-link').forEach(link => {
                            if (link.getAttribute('data-target') === 'scribe-desk-view') {
                                link.classList.add('active');
                            } else {
                                link.classList.remove('active');
                            }
                        });
                    });
                }

                const sourceLabel = `(${matchInfo.matchedVerse.bookHeb} פרק ${numberToHebrew(matchInfo.matchedVerse.chapter)} פסוק ${numberToHebrew(matchInfo.matchedVerse.verse)})`;
                item.innerHTML = `
                    <div style="font-size: 0.85rem; color: var(--text-muted); font-family: var(--font-sans); margin-bottom: 0.15rem;">
                        הקבלה לשורה #${matchInfo.lineNum} (גימטריה: ${matchInfo.gematria})
                    </div>
                    <div>${matchInfo.matchedVerse.originalText} <span style="color: var(--accent-gold); font-size: 0.95rem; font-family: var(--font-sans);">${sourceLabel}</span></div>
                `;
                detailsList.appendChild(item);
            });

            bookCard.appendChild(header);
            bookCard.appendChild(detailsList);
            booksListEl.appendChild(bookCard);
        });

        resultsContainer.style.display = 'block';
        sortControls.style.display = 'flex';
    }

    function runAnalysis() {
        const rawText = input.value.trim();
        if (!rawText) {
            resultsContainer.style.display = 'none';
            sortControls.style.display = 'none';
            return;
        }

        // Note: Excluded from State.sharedVerse per user request
        addToHistory('gematria', rawText);

        const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) {
            resultsContainer.style.display = 'none';
            sortControls.style.display = 'none';
            return;
        }

        const linesData = [];
        const bookStats = {};

        lines.forEach((lineText, idx) => {
            const score = calculateGematria(lineText);
            if (score > 0) {
                const matches = State.tanakhVerses.filter(v => v.gematria === score);
                linesData.push({
                    lineNum: idx + 1,
                    lineText: lineText,
                    gematria: score,
                    matchesCount: matches.length
                });

                matches.forEach(m => {
                    if (!bookStats[m.bookHeb]) {
                        bookStats[m.bookHeb] = {
                            bookHeb: m.bookHeb,
                            totalMatchesCount: 0,
                            verseMatches: []
                        };
                    }
                    bookStats[m.bookHeb].totalMatchesCount += 1;
                    bookStats[m.bookHeb].verseMatches.push({
                        lineNum: idx + 1,
                        lineText: lineText,
                        gematria: score,
                        matchedVerse: m
                    });
                });
            }
        });

        lastLinesData = linesData;
        lastBookStats = bookStats;
        renderResults();
    }

    let multiDebounce = null;
    input.addEventListener('input', () => {
        clearTimeout(multiDebounce);
        multiDebounce = setTimeout(() => {
            runAnalysis();
        }, 500);
    });

    analyzeBtn.addEventListener('click', () => {
        clearTimeout(multiDebounce);
        runAnalysis();
    });

    if (sortCanonicalBtn && sortCountBtn) {
        sortCanonicalBtn.addEventListener('click', () => {
            currentSortMode = 'canonical';
            sortCanonicalBtn.classList.add('active');
            sortCountBtn.classList.remove('active');
            renderResults();
        });
        sortCountBtn.addEventListener('click', () => {
            currentSortMode = 'count';
            sortCountBtn.classList.add('active');
            sortCanonicalBtn.classList.remove('active');
            renderResults();
        });
    }
}

