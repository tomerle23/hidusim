import http.server
import socketserver
import json
import os
import urllib.parse
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for all local network requests
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        
        # Disable browser caching for html, js, and css files to force loading the new sync logic
        url_path = self.path.split('?')[0]
        if url_path.endswith('.js') or url_path.endswith('.html') or url_path.endswith('.css') or url_path == '/' or url_path == '':
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/get_data':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            db_path = os.path.join(DIRECTORY, 'user_db.json')
            data = {}
            if os.path.exists(db_path):
                try:
                    with open(db_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                except Exception as e:
                    print("Error reading user_db.json:", e, file=sys.stderr)
            
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
            return
            
        return super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/save_data':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                new_data = json.loads(post_data.decode('utf-8'))
                
                db_path = os.path.join(DIRECTORY, 'user_db.json')
                existing_data = {}
                if os.path.exists(db_path):
                    try:
                        with open(db_path, 'r', encoding='utf-8') as f:
                            existing_data = json.load(f)
                    except Exception as e:
                        print("Error loading existing database, initializing new:", e, file=sys.stderr)
                
                # Merge incoming key-value pairs (overwrite/update fields)
                existing_data.update(new_data)
                
                with open(db_path, 'w', encoding='utf-8') as f:
                    json.dump(existing_data, f, ensure_ascii=False, indent=4)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
                print("Database user_db.json updated successfully.", file=sys.stdout)
            except Exception as e:
                print("Error saving database:", e, file=sys.stderr)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return

        elif parsed_url.path == '/apply_fixes':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                fixes = json.loads(post_data.decode('utf-8'))
                
                # Load tanakh_data.js
                js_path = os.path.join(DIRECTORY, 'tanakh_data.js')
                with open(js_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
                    content = f.read()
                
                json_start = content.find('{')
                json_end = content.rfind('}') + 1
                prefix = content[:json_start]
                json_str = content[json_start:json_end]
                suffix = content[json_end:]
                
                tanakh_data = json.loads(json_str)
                
                for fix in fixes:
                    candidate = fix['candidate']
                    choice = fix['choice'] # 'ketiv' or 'qere'
                    
                    book = candidate['book']
                    chapter_idx = candidate['chapter'] - 1
                    verse_idx = candidate['verse'] - 1
                    word_idx = candidate['wordIdx']
                    
                    # Compute corrected word value
                    if choice == 'ketiv':
                        corrected_val = candidate['ketiv']
                    else:
                        corrected_val = candidate['rest']
                    
                    # Update word in tanakh_data
                    words_list = tanakh_data[book][chapter_idx][verse_idx]
                    # Make sure it's the exact corrupted word
                    if words_list[word_idx] == candidate['corruptedWord']:
                        # If the corrected value contains spaces (e.g. next word was merged)
                        # we might want to split it, but let's just insert it
                        # Let's clean the corrected_val if it has spaces
                        subwords = corrected_val.split()
                        words_list[word_idx:word_idx+1] = subwords
                
                # Save tanakh_data.js
                corrected_js = prefix + json.dumps(tanakh_data, ensure_ascii=False, indent=2) + suffix
                with open(js_path, 'w', encoding='utf-8-sig') as f:
                    f.write(corrected_js)
                
                # Also remove fixed candidates from corrupted_verses.json
                corr_path = os.path.join(DIRECTORY, 'corrupted_verses.json')
                if os.path.exists(corr_path):
                    with open(corr_path, 'r', encoding='utf-8') as f:
                        curr_candidates = json.load(f)
                    
                    fixed_keys = {(f['candidate']['book'], f['candidate']['chapter'], f['candidate']['verse'], f['candidate']['wordIdx']) for f in fixes}
                    updated_candidates = [c for c in curr_candidates if (c['book'], c['chapter'], c['verse'], c['wordIdx']) not in fixed_keys]
                    
                    with open(corr_path, 'w', encoding='utf-8') as f:
                        json.dump(updated_candidates, f, ensure_ascii=False, indent=2)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
                print(f"Successfully applied {len(fixes)} corrections to tanakh_data.js.", file=sys.stdout)
            except Exception as e:
                print("Error applying fixes:", e, file=sys.stderr)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return
            
        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        pass
        
    print(f"Starting server on http://localhost:{PORT}...")
    print(f"To connect from another computer on network, open: http://<your-ip>:{PORT}")
    
    server = ThreadingHTTPServer(('0.0.0.0', PORT), MyHTTPRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Server stopped.")
