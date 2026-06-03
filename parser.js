/**
 * parser.js - Torah Study Sheet Parser
 * Parses plain-text files containing structured Torah insights.
 */

function parseTorahText(text) {
    const lines = text.split('\n'); // Preserve leading whitespace
    
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
        const line = lines[i].trim();
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
    let currentSubsection = ""; // "peshat_derash_remez", "toda_hashem"
    let currentGematria = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // Skip metadata header lines at the very beginning
        if (i < 10 && (trimmedLine === result.title || trimmedLine === result.subTitle || trimmedLine === result.versesRange || trimmedLine.includes("ימים") || trimmedLine.includes("התשפ") || trimmedLine.includes("במרץ"))) {
            continue;
        }
        
        // Detect new verse section: e.g. "(כג) וָאֶתְחַנַּן..."
        const verseMatch = trimmedLine.match(/^\(([\u0590-\u05fe]{1,3})\)\s*(.*)$/);
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
                generalInsights: [],
                todaHashem: [] // array of {title, content} objects
            };
            currentSection = "";
            currentSubsection = "";
            continue;
        }
        
        // Detect subsection switches (first-level bullet points without leading spaces)
        if (line.startsWith('*') || (line.startsWith(' *') && !line.startsWith('  '))) {
            const cleanText = trimmedLine.replace(/\*/g, '').trim();
            if (cleanText.includes("פשט דרש ורמז") || cleanText.includes("פשט") || cleanText.includes("דרש")) {
                currentSubsection = "peshat_derash_remez";
                continue;
            } else if (cleanText.includes("תודה ה'")) {
                currentSubsection = "toda_hashem";
                continue;
            }
        }
        
        // Detect section changes
        const lowerLine = trimmedLine.toLowerCase();
        if (lowerLine.startsWith("פשט:") || lowerLine.startsWith("פשט דרש ורמז:") || lowerLine === "פשט דרש ורמז") {
            currentSection = "peshat";
            const content = trimmedLine.includes(":") ? trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim() : "";
            if (content && currentVerse) currentVerse.interpretations.peshat.push(content);
            continue;
        }
        if (lowerLine.startsWith("רמז:")) {
            currentSection = "remez";
            const content = trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.remez.push(content);
            continue;
        }
        if (lowerLine.startsWith("דרש:")) {
            currentSection = "derash";
            const content = trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.derash.push(content);
            continue;
        }
        if (lowerLine.startsWith("סוד:")) {
            currentSection = "sod";
            const content = trimmedLine.substring(trimmedLine.indexOf(":") + 1).trim();
            if (content && currentVerse) currentVerse.interpretations.sod.push(content);
            continue;
        }
        
        // Detect Gematria section: e.g. "גימטריה 1332"
        const gematriaMatch = trimmedLine.match(/^גימטריה\s+(\d+)$/);
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
        const essayMatch = trimmedLine.match(/^([^—\-:]{3,45}?)\s*([—\-:]+)\s*(.*)$/);
        if (essayMatch && !trimmedLine.startsWith("פשט") && !trimmedLine.startsWith("רמז") && !trimmedLine.startsWith("דרש") && !trimmedLine.startsWith("סוד") && !trimmedLine.includes("גימטריה") && !trimmedLine.includes("א=") && !trimmedLine.includes("ח=") && !trimmedLine.includes("ד=")) {
            const title = essayMatch[1].trim();
            const content = essayMatch[3].trim();
            
            // Validate it's indeed an essay
            if (title.length > 2 && content.length > 20 && !title.includes("(") && !title.includes(")") && !title.includes("=")) {
                if (currentVerse) {
                    if (currentSubsection === "toda_hashem") {
                        currentVerse.todaHashem.push({
                            title: `<b>${title}</b>`,
                            content: [content]
                        });
                    } else {
                        currentVerse.generalInsights.push(`<b>${title}</b> - ${content}`);
                    }
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
            const connMatch = trimmedLine.match(/^(.*?)\(([\u0590-\u05fe\s0-9,:\"]+[^)]+)\)\s*[–-]\s*(.*)$/);
            if (connMatch) {
                currentGematria.connections.push({
                    verseText: connMatch[1].trim(),
                    source: connMatch[2].trim(),
                    explanation: connMatch[3].trim()
                });
            } else {
                currentGematria.explanation.push(line); // Preserve line indentation
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
            if (currentSubsection === "toda_hashem") {
                // If it is a second-level bullet point under Toda Hashem
                if (line.startsWith('  *') && !line.startsWith('   ')) {
                    const titleText = trimmedLine.replace(/^\*\s*/, '').trim();
                    currentVerse.todaHashem.push({
                        title: titleText,
                        content: []
                    });
                } else {
                    // Append to the last sub-item
                    if (currentVerse.todaHashem.length > 0) {
                        currentVerse.todaHashem[currentVerse.todaHashem.length - 1].content.push(line);
                    } else {
                        // Fallback if no sub-item was created yet
                        const titleText = trimmedLine.replace(/^\*\s*/, '').trim();
                        currentVerse.todaHashem.push({
                            title: titleText,
                            content: []
                        });
                    }
                }
            } else {
                currentVerse.generalInsights.push(line);
            }
        } else {
            // Global sheet introduction or general notes
            if (!trimmedLine.includes("10/08") && !trimmedLine.includes("ימים") && !trimmedLine.includes("התשפ") && !trimmedLine.includes("במרץ") && trimmedLine !== "תודה ה'") {
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
        insight.generalInsights = insight.generalInsights.filter(l => l.trim() !== "תודה ה'").join('\n').trim();
        
        // Post-process todaHashem array
        insight.todaHashem.forEach(subItem => {
            subItem.title = subItem.title.replace(/^\*\s*/, '').trim();
            subItem.content = subItem.content.filter(l => l.trim() !== "תודה ה'").join('\n').trim();
        });
        // Remove empty subItems
        insight.todaHashem = insight.todaHashem.filter(subItem => subItem.title.length > 0 || subItem.content.length > 0);
        
        if (insight.gematria) {
            insight.gematria.explanation = insight.gematria.explanation.filter(l => l.trim() !== "תודה ה'").join('\n').trim();
        }
    });
    
    result.essays = result.essays.filter(essay => essay.content.trim().length > 0);
    
    return result;
}

// Support browser and Node environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTorahText };
}
