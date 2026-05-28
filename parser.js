/**
 * parser.js - Torah Study Sheet Parser
 * Parses plain-text files containing structured Torah insights.
 */

function parseTorahText(text) {
    const lines = text.split('\n').map(line => line.trim());
    
    let result = {
        title: "",
        subTitle: "",
        versesRange: "",
        insights: [],
        essays: [],
        gematrias: []
    };
    
    // Detect basic metadata
    for (let i = 0; i < Math.min(12, lines.length); i++) {
        const line = lines[i];
        if (!line) continue;
        if (line.includes("פרשת ואתחנן") || line.includes("פרשת ")) {
            result.title = line;
        } else if (line.includes("עליות") || line.includes("עליה") || line.includes("פרק ")) {
            if (!result.subTitle && (line.includes("ראשון") || line.includes("שני") || line.includes("עליה"))) {
                result.subTitle = line;
            } else if (line.includes("פרק") && line.includes("פסוק")) {
                result.versesRange = line;
            }
        }
    }
    
    if (!result.title) result.title = "חידושי תורה";
    
    let currentVerse = null;
    let currentSection = ""; // "peshat", "remez", "derash", "sod", "gematria", "essay"
    let currentGematria = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        // Skip metadata header lines at the very beginning
        if (i < 10 && (line === result.title || line === result.subTitle || line === result.versesRange || line.includes("ימים") || line.includes("התשפ") || line.includes("במרץ"))) {
            continue;
        }
        
        // Detect new verse section: e.g. "(כג) וָאֶתְחַנַּן..."
        const verseMatch = line.match(/^\(([\u0590-\u05fe]{1,3})\)\s*(.*)$/);
        if (verseMatch) {
            if (currentVerse) {
                result.insights.push(currentVerse);
            }
            if (currentGematria) {
                result.gematrias.push(currentGematria);
                currentGematria = null;
            }
            
            currentVerse = {
                verseNum: verseMatch[1],
                verseText: verseMatch[2],
                category: "תורה", // default category
                interpretations: {
                    peshat: [],
                    remez: [],
                    derash: [],
                    sod: []
                },
                gematria: null,
                generalInsights: []
            };
            currentSection = "";
            continue;
        }
        
        // Detect section changes
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith("פשט:") || lowerLine.startsWith("פשט דרש ורמז:") || lowerLine === "פשט דרש ורמז") {
            currentSection = "peshat";
            const content = line.includes(":") ? line.substring(line.indexOf(":") + 1).trim() : "";
            if (content && currentVerse) currentVerse.interpretations.peshat.push(content);
            continue;
        }
        if (lowerLine.startsWith("רמז:")) {
            currentSection = "remez";
            const content = line.substring(line.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.remez.push(content);
            continue;
        }
        if (lowerLine.startsWith("דרש:")) {
            currentSection = "derash";
            const content = line.substring(line.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.derash.push(content);
            continue;
        }
        if (lowerLine.startsWith("סוד:")) {
            currentSection = "sod";
            const content = line.substring(line.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.sod.push(content);
            continue;
        }
        
        // Detect Gematria section: e.g. "גימטריה 1332"
        const gematriaMatch = line.match(/^גימטריה\s+(\d+)$/);
        if (gematriaMatch) {
            currentSection = "gematria";
            if (currentGematria) {
                result.gematrias.push(currentGematria);
            }
            currentGematria = {
                value: parseInt(gematriaMatch[1]),
                connections: [],
                explanation: [],
                associatedVerseNum: currentVerse ? currentVerse.verseNum : ""
            };
            continue;
        }
        
        // Detect essays/standalone topics: e.g. "ואתחנן כוחה של תפילה - פרשת ואתחנן..."
        // Matches lines with a separator like ' - ' or ' : ' where the title is concise and content is long.
        const essayMatch = line.match(/^([^—\-:]{3,45}?)\s*([—\-:]+)\s*(.*)$/);
        if (essayMatch && !line.startsWith("פשט") && !line.startsWith("רמז") && !line.startsWith("דרש") && !line.startsWith("סוד") && !line.includes("גימטריה") && !line.includes("א=") && !line.includes("ח=") && !line.includes("ד=")) {
            const title = essayMatch[1].trim();
            const content = essayMatch[3].trim();
            
            // Validate it's indeed an essay (long content, short title, no parenthesis)
            if (title.length > 2 && content.length > 20 && !title.includes("(") && !title.includes(")") && !title.includes("=")) {
                if (currentVerse) {
                    currentVerse.generalInsights.push(`<b>${title}</b> - ${content}`);
                } else {
                    result.essays.push({
                        title: title,
                        content: content,
                        associatedVerseNum: ""
                    });
                }
                continue;
            }
        }
        
        // Process line content based on active section
        if (currentSection === "gematria" && currentGematria) {
            // Verse connection: e.g. "וַיְדַבֵּ֣ר אֱלֹהִ֔ים... (שמות כ, א) – הקדמה למעמד הר סיני."
            // We search for parenthesis containing source, and a separator - or –
            const connMatch = line.match(/^(.*?)\(([\u0590-\u05fe\s0-9,:\"]+[^)]+)\)\s*[–-]\s*(.*)$/);
            if (connMatch) {
                currentGematria.connections.push({
                    verseText: connMatch[1].trim(),
                    source: connMatch[2].trim(),
                    explanation: connMatch[3].trim()
                });
            } else {
                currentGematria.explanation.push(line);
            }
            continue;
        }
        
        if (currentSection === "peshat" && currentVerse) {
            currentVerse.interpretations.peshat.push(line);
            continue;
        }
        if (currentSection === "remez" && currentVerse) {
            currentVerse.interpretations.remez.push(line);
            continue;
        }
        if (currentSection === "derash" && currentVerse) {
            currentVerse.interpretations.derash.push(line);
            continue;
        }
        if (currentSection === "sod" && currentVerse) {
            currentVerse.interpretations.sod.push(line);
            continue;
        }
        
        // General text under current verse or global
        if (currentVerse) {
            if (line === "תודה ה'") {
                currentSection = "";
                continue;
            }
            currentVerse.generalInsights.push(line);
        } else {
            // Global sheet introduction or general notes
            if (!line.includes("10/08") && !line.includes("ימים") && !line.includes("התשפ") && !line.includes("במרץ") && line !== "תודה ה'") {
                result.essays.push({
                    title: "מבוא ללימוד",
                    content: line,
                    associatedVerseNum: ""
                });
            }
        }
    }
    
    // Save last items
    if (currentVerse) {
        result.insights.push(currentVerse);
    }
    if (currentGematria) {
        result.gematrias.push(currentGematria);
    }
    
    // Link gematrias back to verses if they are associated
    result.insights.forEach(insight => {
        const gem = result.gematrias.find(g => g.associatedVerseNum === insight.verseNum);
        if (gem) {
            insight.gematria = gem;
        }
    });
    
    // Post-process arrays to join lines into clean strings and filter out noise
    result.insights.forEach(insight => {
        for (let key in insight.interpretations) {
            insight.interpretations[key] = insight.interpretations[key].join('\n').trim();
        }
        insight.generalInsights = insight.generalInsights.filter(l => l !== "תודה ה'").join('\n').trim();
        if (insight.gematria) {
            insight.gematria.explanation = insight.gematria.explanation.filter(l => l !== "תודה ה'").join('\n').trim();
        }
    });
    
    // Join adjacent general essays that have empty titles to make them coherent
    result.essays = result.essays.filter(essay => essay.content.trim().length > 0);
    
    // Group essays that belong to the same topic if they were split
    return result;
}

// Support browser and Node environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTorahText };
}
