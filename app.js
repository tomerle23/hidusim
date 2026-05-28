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
    activeView: 'study-hall-view',
    selectedInsightId: null,
    activePardesTab: 'peshat',
    activeLibraryTab: 'bookmarks',
    fontSize: 18,        // Default reader font size in pixels
    theme: 'light',
    tanakhVerses: [],    // Indexed offline verses of the entire Tanakh
    userRole: 'user',    // 'user' or 'admin'
    pendingRequests: [], // Admin approval queue
    deletedDefaultIds: [], // IDs of deleted default insights
    editedDefaultInsights: {} // Merged edits of default insights keyed by ID
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
    const bookNames = Object.keys(TanakhData);
    
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
    console.timeEnd("Indexing Tanakh");
    console.log(`Indexed ${State.tanakhVerses.length} verses from local Tanakh.`);
}

// --- Sefaria API Tanakh Integration ---
const SefariaBookMap = {
    "בראשית": "Genesis", "שמות": "Exodus", "ויקרא": "Leviticus", "במדבר": "Numbers", "דברים": "Deuteronomy",
    "יהושע": "Joshua", "שופטים": "Judges", "שמואל א": "I Samuel", "שמואל ב": "II Samuel", "מלכים א": "I Kings", "מלכים ב": "II Kings",
    "ישעיהו": "Isaiah", "ירמיהו": "Jeremiah", "יחזקאל": "Ezekiel", "הושע": "Hosea", "יואל": "Joel", "עמוס": "Amos",
    "עובדיה": "Obadiah", "יונה": "Jonah", "מיכה": "Micah", "נחום": "Nahum", "חבקוק": "Habakkuk", "צפניה": "Zephaniah",
    "חגי": "Haggai", "זכריה": "Zechariah", "מלאכי": "Malachi", "תהילים": "Psalms", "תהלים": "Psalms", "משלי": "Proverbs", "איוב": "Job",
    "שיר השירים": "Song of Songs", "רות": "Ruth", "איכה": "Lamentations", "קהלת": "Ecclesiastes", "אסתר": "Esther",
    "דניאל": "Daniel", "עזרא": "Ezra", "נחמיה": "Nehemiah", "דברי הימים א": "I Chronicles", "דברי הימים ב": "II Chronicles"
};

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

    const theme = localStorage.getItem('torah_theme');
    if (theme) {
        State.theme = theme;
        document.body.setAttribute('data-theme', theme);
        updateThemeToggleIcon();
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
}

function saveLocalStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
    updateStats();
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
            }
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
            } else if (State.activeView === 'admin-requests-view') {
                renderAdminRequests();
            }
        });
    }

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => {
        State.theme = State.theme === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', State.theme);
        localStorage.setItem('torah_theme', State.theme);
        updateThemeToggleIcon();
    });

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

function updateThemeToggleIcon() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (State.theme === 'dark') {
        toggleBtn.innerHTML = '<i class="fa-solid fa-sun" style="color: var(--accent-gold);"></i>';
        toggleBtn.title = "מצב לימוד יום";
    } else {
        toggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        toggleBtn.title = "מצב לימוד לילה";
    }
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

// --- View 1: Render Insights Grid (Study Hall Feed) ---
function renderInsightsGrid() {
    const grid = document.getElementById('insights-grid');
    grid.innerHTML = "";

    const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
    const activeCategory = document.querySelector('.category-tab.active').getAttribute('data-category');
    const sortVal = document.getElementById('sort-select').value;

    const searchRef = parseSearchQueryReference(searchQuery);

    let filtered = State.insights.filter(insight => {
        // Reference search filter (e.g. "דברים ג" or "דברים ג, כג")
        if (searchRef) {
            let parsed = parseHebrewReference(insight.verseText);
            if (!parsed) {
                const resolvedBook = resolveBookName(insight.parasha);
                if (resolvedBook) {
                    parsed = {
                        bookHeb: resolvedBook,
                        chapter: insight.chapter || 1,
                        verse: insight.verseNum ? calculateGematria(insight.verseNum) : 1
                    };
                } else if (insight.verseNum) {
                    parsed = {
                        bookHeb: "דברים",
                        chapter: insight.chapter || 3,
                        verse: calculateGematria(insight.verseNum)
                    };
                }
            }
            
            if (parsed) {
                const bookMatch = parsed.bookHeb === searchRef.bookHeb;
                const chapMatch = searchRef.chapter === null || parsed.chapter === searchRef.chapter;
                const verseMatch = searchRef.verse === null || parsed.verse === searchRef.verse;
                if (bookMatch && chapMatch && verseMatch) return true;
            }
        }

        // Fallback or normal text search
        const matchSearch = 
            (insight.verseText && insight.verseText.toLowerCase().includes(searchQuery)) ||
            (insight.generalInsights && insight.generalInsights.toLowerCase().includes(searchQuery)) ||
            (insight.interpretations.peshat && insight.interpretations.peshat.toLowerCase().includes(searchQuery)) ||
            (insight.author && insight.author.toLowerCase().includes(searchQuery)) ||
            (insight.id && insight.id.toLowerCase().includes(searchQuery));
            
        return matchSearch;
    });

    // Category filter
    filtered = filtered.filter(insight => {
        let matchCategory = true;
        if (activeCategory !== 'all') {
            if (activeCategory === 'נך') {
                matchCategory = insight.category === 'נ"ך' || insight.category === 'נך' || insight.category === 'נביאים' || insight.category === 'כתובים';
            } else {
                matchCategory = insight.category === activeCategory;
            }
        }
        return matchCategory;
    });

    // Sort
    if (sortVal === 'newest') {
        // Default loading order, user written insights first
        filtered.sort((a, b) => {
            if (a.id.startsWith('user_') && !b.id.startsWith('user_')) return -1;
            if (!a.id.startsWith('user_') && b.id.startsWith('user_')) return 1;
            return 0;
        });
    } else if (sortVal === 'popular') {
        // Sort by upvotes count
        filtered.sort((a, b) => {
            const votesA = State.upvotes[a.id] || 0;
            const votesB = State.upvotes[b.id] || 0;
            return votesB - votesA;
        });
    } else if (sortVal === 'length') {
        // Sort by content character count
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
        const card = document.createElement('div');
        card.className = 'insight-card';
        card.addEventListener('click', () => openInsightReader(insight.id));
        
        const votes = State.upvotes[insight.id] || 0;
        const commentCount = State.comments[insight.id] ? State.comments[insight.id].length : 0;
        
        let snippetText = insight.interpretations.peshat || insight.generalInsights || "";
        if (snippetText.length > 150) {
            snippetText = snippetText.substring(0, 150) + "...";
        }
        
        const headingTitle = insight.verseNum ? `פסוק ${insight.verseNum}` : insight.verseText;
        const resolvedBook = resolveBookName(insight.parasha) || "דברים";
        const sourceLabel = insight.verseNum ? `${insight.parasha} (${resolvedBook})` : (insight.category || "חידוש");
        
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
            const editBtn = card.querySelector('.admin-edit-btn');
            const splitBtn = card.querySelector('.admin-split-btn');
            const deleteBtn = card.querySelector('.admin-delete-btn');

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openAdvancedEditModal(insight.id);
            });
            splitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSplitCommentaryModal(insight.id);
            });
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCommentary(insight.id);
            });
        }

        grid.appendChild(card);
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
            renderInsightsGrid();
        });
    });
}

// --- View 2: Render Reader View (Insight Detail) ---
function openInsightReader(id) {
    const insight = State.insights.find(item => item.id === id);
    if (!insight) return;

    State.selectedInsightId = id;
    switchView('insight-reader-view');

    // Populate metadata
    document.getElementById('reader-category').innerText = insight.category;
    document.getElementById('reader-title').innerText = insight.verseNum ? `ביאור לפסוק ${insight.verseNum}` : insight.verseText;
    document.getElementById('reader-author').innerText = insight.author;
    document.getElementById('reader-parasha').innerText = insight.parasha || "כללי";

    // Populate scripture block
    document.getElementById('reader-verse-text').innerText = insight.verseText;
    if (insight.verseNum) {
        const bookNameHeb = resolveBookName(insight.parasha) || "דברים";
        const isTorah = ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"].includes(bookNameHeb);
        const prefixWord = isTorah ? "חומש" : "ספר";
        const parashaPart = (insight.parasha && insight.parasha !== bookNameHeb && !insight.parasha.startsWith("פרשה חיצונית")) ? `, פרשת ${insight.parasha}` : "";
        const chapterNumHeb = numberToHebrew(insight.chapter);
        document.getElementById('reader-verse-source').innerText = `${prefixWord} ${bookNameHeb}${parashaPart}, פרק ${chapterNumHeb} פסוק ${insight.verseNum}`;
        document.getElementById('reader-verse-block').style.display = 'block';
        
        // Dynamically fetch vocalized Tanakh text from Sefaria API
        const refStr = `${bookNameHeb} ${insight.chapter}, ${insight.verseNum}`;
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
                <div class="pardes-section-title">הרחבות והארות נוספות</div>
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
}

function applyReaderFontSize() {
    const elements = [
        document.getElementById('reader-verse-text'),
        document.getElementById('reader-general-text')
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
        fetchTanakhVerse(val).then(vocalized => {
            if (vocalized) {
                vocalizedSpan.innerHTML = vocalized;
                // Save it in the dataset for later use
                verseInput.dataset.vocalized = vocalized;
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
function initGematriaCalculator() {
    const calcInput = document.getElementById('calc-input');
    const resultBox = document.getElementById('calc-result-box');
    const resultNum = document.getElementById('calc-result-num');
    const resultHeb = document.getElementById('calc-result-heb');
    const matchesSection = document.getElementById('calc-matches-section');
    const matchesGrid = document.getElementById('calc-matches-grid');

    calcInput.addEventListener('input', () => {
        const val = calcInput.value.trim();
        if (!val) {
            resultBox.style.display = 'none';
            matchesSection.style.display = 'none';
            return;
        }

        const score = calculateGematria(val);
        if (score === 0) {
            resultBox.style.display = 'none';
            matchesSection.style.display = 'none';
            return;
        }

        // Show result
        resultBox.style.display = 'flex';
        resultNum.innerText = score;
        resultHeb.innerText = `בגימטריה: ${numberToHebrew(score)}`;

        // Scan the entire Tanakh for matches
        const matches = State.tanakhVerses.filter(v => v.gematria === score);

        // Render matches
        matchesGrid.innerHTML = "";
        if (matches.length > 0) {
            matchesSection.style.display = 'block';
            
            // Limit to first 50 results
            const limit = 50;
            const displayMatches = matches.slice(0, limit);
            
            if (matches.length > limit) {
                const note = document.createElement('div');
                note.style.gridColumn = '1 / -1';
                note.style.textAlign = 'center';
                note.style.color = 'var(--accent-gold)';
                note.style.fontWeight = 'bold';
                note.style.marginBottom = '1rem';
                note.innerText = `נמצאו ${matches.length} פסוקים בגימטריה זו. מציג את 50 הראשונים:`;
                matchesGrid.appendChild(note);
            }

            displayMatches.forEach(match => {
                const insightMatch = findInsightByCoordinate(match.bookHeb, match.chapter, match.verse);
                const card = document.createElement('div');
                card.className = `insight-card ${insightMatch ? 'has-commentary-card' : 'no-commentary-card'}`;
                
                if (insightMatch) {
                    card.addEventListener('click', () => {
                        openInsightReader(insightMatch.id);
                        switchView('insight-reader-view');
                    });
                } else {
                    card.addEventListener('click', () => {
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
                
                const headingTitle = `${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)}`;
                const badgeLabel = insightMatch ? `<span class="card-category" style="background-color: rgba(var(--accent-gold-rgb), 0.15); color: var(--accent-gold);"><i class="fa-solid fa-book-open"></i> יש פירוש</span>` : `<span class="card-category" style="background-color: var(--bg-secondary); color: var(--text-muted);"><i class="fa-solid fa-pen-clip"></i> כתוב פירוש</span>`;
                
                card.innerHTML = `
                    <div class="card-header">
                        ${badgeLabel}
                        <span class="card-date">גימטריה ${score}</span>
                    </div>
                    <h3 class="card-title">${headingTitle}</h3>
                    <div class="card-verse">${match.originalText}</div>
                    <div class="card-footer" style="border-top: none; padding-top: 0;">
                        <span class="card-author"><i class="fa-regular fa-bookmark"></i> ${insightMatch ? insightMatch.author : 'מאגר תנ"ך מקומי'}</span>
                    </div>
                `;
                matchesGrid.appendChild(card);
            });
        } else {
            matchesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 2rem 0;">
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

        // Update count
        matchesCount.innerText = matches.length;
        matchesSection.style.display = 'block';

        matchesGrid.innerHTML = "";
        
        // Show first 50 results to prevent DOM lag
        const limit = 50;
        const displayMatches = matches.slice(0, limit);

        if (matches.length > limit) {
            const note = document.createElement('div');
            note.style.gridColumn = '1 / -1';
            note.style.textAlign = 'center';
            note.style.color = 'var(--accent-gold)';
            note.style.fontWeight = 'bold';
            note.style.marginBottom = '1rem';
            note.innerText = `נמצאו ${matches.length} תוצאות. מציג את 50 הראשונות:`;
            matchesGrid.appendChild(note);
        }

        if (displayMatches.length > 0) {
            displayMatches.forEach(match => {
                const insightMatch = findInsightByCoordinate(match.bookHeb, match.chapter, match.verse);
                
                const card = document.createElement('div');
                card.className = `insight-card ${insightMatch ? 'has-commentary-card' : 'no-commentary-card'}`;
                
                if (insightMatch) {
                    card.addEventListener('click', () => {
                        openInsightReader(insightMatch.id);
                        switchView('insight-reader-view');
                    });
                } else {
                    card.addEventListener('click', () => {
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
                
                const headingTitle = `${match.bookHeb} פרק ${numberToHebrew(match.chapter)} פסוק ${numberToHebrew(match.verse)}`;
                const badgeLabel = insightMatch ? `<span class="card-category" style="background-color: rgba(var(--accent-gold-rgb), 0.15); color: var(--accent-gold);"><i class="fa-solid fa-book-open"></i> יש פירוש</span>` : `<span class="card-category" style="background-color: var(--bg-secondary); color: var(--text-muted);"><i class="fa-solid fa-pen-clip"></i> כתוב פירוש</span>`;
                
                card.innerHTML = `
                    <div class="card-header">
                        ${badgeLabel}
                        <span class="card-date">תנ"ך</span>
                    </div>
                    <h3 class="card-title">${headingTitle}</h3>
                    <div class="card-verse">${match.originalText}</div>
                    <div class="card-footer" style="border-top: none; padding-top: 0;">
                        <span class="card-author"><i class="fa-regular fa-bookmark"></i> ${insightMatch ? insightMatch.author : 'מאגר תנ"ך מקומי'}</span>
                    </div>
                `;
                matchesGrid.appendChild(card);
            });
        } else {
            matchesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; padding: 2rem 0;">
                    <p>לא נמצאו פסוקים המכילים את רצף האותיות "${query}".</p>
                </div>
            `;
        }
    });
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
            titleText = item.verseNum ? `ביאור לפסוק ${item.verseNum} (${item.parasha})` : item.verseText;
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
    initWordRepetitionCalculator();
    initLibraryView();
    initAdminModals(); // Initialize modal handlers for Admin
    loadDefaultData();
});
