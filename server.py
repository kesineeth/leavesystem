import os
import json
import sqlite3
import urllib.parse
import base64
import hashlib
import hmac
import time
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime

PORT = int(os.environ.get('PORT', 8000))
DB_FILE = 'database.db'
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), 'public')
UPLOADS_DIR = os.path.join(PUBLIC_DIR, 'uploads')

# Generate a secure random server-wide key for HMAC signature on startup
SERVER_SECRET_KEY = secrets.token_bytes(32)

# --- Security Functions ---

def hash_password(password: str) -> str:
    """Hash password using PBKDF2 with SHA-256 and salt."""
    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return f"pbkdf2:sha256:100000${salt}${pw_hash.hex()}"

def check_password(stored_password: str, provided_password: str) -> bool:
    """Verify password. Supports migration from plain text legacy seeds."""
    if not stored_password.startswith("pbkdf2:sha256:100000$"):
        # Legacy plain text comparison
        return stored_password == provided_password
        
    try:
        parts = stored_password.split('$')
        salt = parts[1]
        stored_hash = parts[2]
        
        pw_hash = hashlib.pbkdf2_hmac(
            'sha256',
            provided_password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return secrets.compare_digest(pw_hash.hex(), stored_hash)
    except Exception:
        return False

def generate_token(user_id: int, role: str) -> str:
    """Generate a cryptographically signed session token valid for 24 hours."""
    expires = int(time.time()) + 24 * 3600
    payload = f"{user_id}.{role}.{expires}"
    
    # Signature using HMAC-SHA256
    sig = hmac.new(SERVER_SECRET_KEY, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    
    # Pack to Base64
    payload_b64 = base64.b64encode(payload.encode('utf-8')).decode('utf-8')
    return f"{payload_b64}.{sig}"

def verify_token(token: str) -> dict:
    """Verify token signature and expiration. Returns dict of claims or None."""
    try:
        parts = token.split('.')
        if len(parts) != 2:
            return None
            
        payload_b64, sig = parts
        payload = base64.b64decode(payload_b64.encode('utf-8')).decode('utf-8')
        
        # Verify signature
        expected_sig = hmac.new(SERVER_SECRET_KEY, payload.encode('utf-8'), hashlib.sha256).hexdigest()
        if not secrets.compare_digest(sig, expected_sig):
            return None
            
        # Parse claims
        user_id, role, expires = payload.split('.')
        
        # Check expiration
        if int(time.time()) > int(expires):
            return None
            
        return {"id": int(user_id), "role": role}
    except Exception:
        return None

# --- Database Setup ---

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    print("Initializing database...")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create users table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT CHECK(role IN ('employee', 'manager', 'hr')) NOT NULL,
        department TEXT NOT NULL,
        sick_leave_limit INTEGER DEFAULT 30,
        personal_leave_limit INTEGER DEFAULT 6,
        vacation_leave_limit INTEGER DEFAULT 10
    )
    ''')
    
    # Check if migration is needed for leaves table
    cursor.execute("PRAGMA table_info(leaves)")
    columns = [row[1] for row in cursor.fetchall()]
    
    needs_recreate = False
    if len(columns) > 0 and 'leave_duration' not in columns:
        print("Database migration required for leaves table...")
        needs_recreate = True
        
    if needs_recreate:
        cursor.execute("ALTER TABLE leaves RENAME TO leaves_old")
        
    # Create leaves table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS leaves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        leave_type TEXT CHECK(leave_type IN ('sick', 'personal', 'vacation')) NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT,
        status TEXT CHECK(status IN ('pending', 'pending_hr', 'approved', 'rejected', 'cancelled')) DEFAULT 'pending',
        created_at TEXT NOT NULL,
        approved_by INTEGER,
        rejection_reason TEXT,
        leave_duration REAL DEFAULT 1.0,
        leave_period TEXT CHECK(leave_period IN ('full', 'morning', 'afternoon')) DEFAULT 'full',
        attachment_path TEXT,
        attachment_name TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(approved_by) REFERENCES users(id) ON DELETE SET NULL
    )
    ''')
    
    if needs_recreate:
        cursor.execute("""
        INSERT INTO leaves (id, user_id, leave_type, start_date, end_date, reason, status, created_at, approved_by, rejection_reason, leave_duration, leave_period)
        SELECT id, user_id, leave_type, start_date, end_date, reason, status, created_at, approved_by, rejection_reason, 
               (strftime('%s', end_date) - strftime('%s', start_date)) / 86400 + 1, 'full'
        FROM leaves_old
        """)
        cursor.execute("DROP TABLE leaves_old")
        print("Migration completed.")
        
    # Seed default users if table is empty (passwords are hashed securely)
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        print("Seeding default users...")
        default_users = [
            ('employee1', hash_password('password123'), 'สมิตา อาสาคติ', 'employee', 'IT', 30, 6, 10),
            ('employee2', hash_password('password123'), 'กิตติพงษ์ แก้ววิเชียร', 'employee', 'Marketing', 30, 6, 10),
            ('employee3', hash_password('password123'), 'นรีรัตน์ รักษาพล', 'employee', 'Sales', 30, 6, 10),
            ('manager1', hash_password('password123'), 'วิชาญ ศรีสมบูรณ์', 'manager', 'IT', 30, 6, 10),
            ('hr1', hash_password('password123'), 'ประภาส เมืองดี', 'hr', 'HR', 30, 6, 10)
        ]
        cursor.executemany(
            "INSERT INTO users (username, password, name, role, department, sick_leave_limit, personal_leave_limit, vacation_leave_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            default_users
        )
        
        # Seed some leave records (historical and pending)
        historical_leaves = [
            (1, 'sick', '2026-05-10', '2026-05-12', 'ไข้หวัดใหญ่', 'approved', '2026-05-09 09:00:00', 4, None, 3.0, 'full', None, None),
            (2, 'sick', '2026-06-01', '2026-06-01', 'ปวดศีรษะ ตัวร้อน', 'approved', '2026-06-01 08:30:00', 4, None, 1.0, 'full', None, None),
            (1, 'personal', '2026-05-20', '2026-05-20', 'ทำธุระติดต่อราชการ (ครึ่งเช้า)', 'approved', '2026-05-18 10:15:00', 4, None, 0.5, 'morning', None, None),
            (3, 'personal', '2026-06-15', '2026-06-16', 'ร่วมพิธีฌาปนกิจญาติ', 'approved', '2026-06-12 14:00:00', 4, None, 2.0, 'full', None, None),
            (1, 'vacation', '2026-06-22', '2026-06-26', 'พักผ่อนประจำปีต่างจังหวัด', 'approved', '2026-06-10 11:00:00', 4, None, 5.0, 'full', None, None),
            (2, 'vacation', '2026-07-01', '2026-07-05', 'เที่ยวพักผ่อนกับครอบครัว', 'approved', '2026-06-20 15:30:00', 4, None, 5.0, 'full', None, None),
            (3, 'vacation', '2026-07-10', '2026-07-15', 'เดินทางไปต่างประเทศ', 'rejected', '2026-07-05 09:00:00', 4, 'ช่วงนี้งานด่วน ต้องส่งมอบระบบ', 6.0, 'full', None, None),
            (1, 'sick', '2026-07-16', '2026-07-17', 'ปวดท้อง ท้องเสียรุนแรง', 'pending', '2026-07-16 08:00:00', None, None, 2.0, 'full', None, None),
            (2, 'personal', '2026-07-20', '2026-07-20', 'นัดตรวจสุขภาพฟัน (ครึ่งบ่าย)', 'pending', '2026-07-15 13:45:00', None, None, 0.5, 'afternoon', None, None),
        ]
        cursor.executemany(
            "INSERT INTO leaves (user_id, leave_type, start_date, end_date, reason, status, created_at, approved_by, rejection_reason, leave_duration, leave_period, attachment_path, attachment_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            historical_leaves
        )
        
    conn.commit()
    conn.close()
    print("Database initialized successfully.")

class APIRequestHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format%args}")

    def send_json(self, data, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_json(self, message, status_code=400):
        self.send_json({"error": message}, status_code)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def get_authorized_user(self):
        """Extract and verify token from Authorization: Bearer <token> header. Loads full user DB row."""
        auth_header = self.headers.get('Authorization')
        if not auth_header:
            return None
        
        try:
            # support "Bearer <token>" or raw "<token>"
            parts = auth_header.split()
            token = parts[1] if len(parts) > 1 and parts[0].lower() == 'bearer' else parts[0]
            
            claims = verify_token(token)
            if not claims:
                return None
            
            conn = get_db_connection()
            user = conn.execute("SELECT * FROM users WHERE id = ?", (claims['id'],)).fetchone()
            conn.close()
            
            # Strict role mismatch verification (role in token must match DB)
            if user and user['role'] == claims['role']:
                return user
            return None
        except Exception:
            return None

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        # --- API Endpoints ---
        if path.startswith('/api/'):
            user = self.get_authorized_user()
            
            if path == '/api/profile':
                if not user:
                    return self.send_error_json("Unauthorized: เซสชันหมดอายุหรือไม่ถูกต้อง", 401)
                
                user_dict = dict(user)
                del user_dict['password']
                
                conn = get_db_connection()
                current_year = datetime.now().strftime('%Y')
                
                balances = {}
                for l_type in ['sick', 'personal', 'vacation']:
                    row = conn.execute(f"""
                        SELECT SUM(leave_duration)
                        FROM leaves
                        WHERE user_id = ? AND leave_type = ? AND status = 'approved'
                          AND (start_date LIKE '{current_year}-%' OR end_date LIKE '{current_year}-%')
                    """, (user['id'], l_type)).fetchone()
                    used = row[0] if row[0] is not None else 0
                    
                    limit = user[f'{l_type}_leave_limit']
                    balances[l_type] = {
                        "limit": limit,
                        "used": used,
                        "remaining": max(0.0, limit - used)
                    }
                
                conn.close()
                user_dict['leave_balances'] = balances
                return self.send_json(user_dict)
            
            elif path == '/api/leaves':
                if not user:
                    return self.send_error_json("Unauthorized", 401)
                
                conn = get_db_connection()
                # Strict RBAC boundary:
                if user['role'] == 'hr':
                    # HR sees all records
                    rows = conn.execute("""
                        SELECT l.*, u.name as employee_name, u.department, u.role as employee_role,
                               m.name as manager_name
                        FROM leaves l
                        JOIN users u ON l.user_id = u.id
                        LEFT JOIN users m ON l.approved_by = m.id
                        ORDER BY l.created_at DESC
                    """).fetchall()
                elif user['role'] == 'manager':
                    # Manager sees department + pending requests
                    rows = conn.execute("""
                        SELECT l.*, u.name as employee_name, u.department, u.role as employee_role,
                               m.name as manager_name
                        FROM leaves l
                        JOIN users u ON l.user_id = u.id
                        LEFT JOIN users m ON l.approved_by = m.id
                        WHERE u.department = ? OR l.status = 'pending'
                        ORDER BY l.created_at DESC
                    """, (user['department'],)).fetchall()
                else:
                    # Employee can ONLY fetch their own leaves
                    rows = conn.execute("""
                        SELECT l.*, u.name as employee_name, u.department, u.role as employee_role,
                               m.name as manager_name
                        FROM leaves l
                        JOIN users u ON l.user_id = u.id
                        LEFT JOIN users m ON l.approved_by = m.id
                        WHERE l.user_id = ?
                        ORDER BY l.created_at DESC
                    """, (user['id'],)).fetchall()
                
                conn.close()
                return self.send_json([dict(r) for r in rows])
            
            elif path == '/api/reports/statistics':
                # Strict Role Guard: Only Manager or HR allowed
                if not user:
                    return self.send_error_json("Unauthorized", 401)
                if user['role'] not in ('hr', 'manager'):
                    return self.send_error_json("Forbidden: ไม่มีสิทธิ์เข้าถึงฟังก์ชันรายงานสถิติ", 403)
                
                conn = get_db_connection()
                stats_rows = conn.execute("""
                    SELECT 
                        strftime('%Y-%m', start_date) AS month,
                        leave_type,
                        SUM(leave_duration) AS total_days
                    FROM leaves
                    WHERE status = 'approved'
                    GROUP BY month, leave_type
                    ORDER BY month ASC
                """).fetchall()
                
                dept_rows = conn.execute("""
                    SELECT 
                        u.department,
                        l.leave_type,
                        SUM(l.leave_duration) AS total_days
                    FROM leaves l
                    JOIN users u ON l.user_id = u.id
                    WHERE l.status = 'approved'
                    GROUP BY u.department, l.leave_type
                """).fetchall()
                
                counts = conn.execute("""
                    SELECT 
                        COUNT(CASE WHEN status IN ('pending', 'pending_hr') THEN 1 END) as pending_count,
                        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
                        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count,
                        COUNT(*) as total_count
                    FROM leaves
                """).fetchone()
                
                conn.close()
                
                return self.send_json({
                    "monthly_stats": [dict(r) for r in stats_rows],
                    "department_stats": [dict(r) for r in dept_rows],
                    "counts": dict(counts)
                })

            elif path == '/api/reports/export':
                # Strict Role Guard: Only Manager or HR allowed
                if not user:
                    return self.send_response(401)
                if user['role'] not in ('hr', 'manager'):
                    return self.send_response(403)
                
                conn = get_db_connection()
                rows = conn.execute("""
                    SELECT l.id, u.name, u.department, u.role, l.leave_type, l.start_date, l.end_date,
                           l.leave_duration as duration, l.leave_period,
                           l.reason, l.status, l.created_at, m.name as approved_by_name
                    FROM leaves l
                    JOIN users u ON l.user_id = u.id
                    LEFT JOIN users m ON l.approved_by = m.id
                    ORDER BY l.created_at DESC
                """).fetchall()
                conn.close()
                
                csv_data = "\ufeffID,พนักงาน,แผนก,บทบาท,ประเภทการลา,วันที่เริ่มต้น,วันที่สิ้นสุด,ช่วงเวลา,จำนวนวันลา,เหตุผล,สถานะ,วันที่ยื่นใบลา,ผู้อนุมัติ\n"
                for r in rows:
                    reason = r['reason'].replace('"', '""') if r['reason'] else ''
                    approved_by = r['approved_by_name'] if r['approved_by_name'] else ''
                    period_th = 'เต็มวัน' if r['leave_period'] == 'full' else ('ครึ่งวันเช้า' if r['leave_period'] == 'morning' else 'ครึ่งวันบ่าย')
                    csv_data += f'{r["id"]},{r["name"]},{r["department"]},{r["role"]},{r["leave_type"]},{r["start_date"]},{r["end_date"]},{period_th},{r["duration"]},"{reason}",{r["status"]},{r["created_at"]},{approved_by}\n'
                
                self.send_response(200)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                self.send_header('Content-Disposition', 'attachment; filename=leave_report.csv')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(csv_data.encode('utf-8'))
                return

            else:
                return self.send_error_json("API Endpoint Not Found", 404)
        
        # --- Static File Serving ---
        else:
            filename = path.lstrip('/')
            if not filename or filename in ('', 'index.html', 'login', 'dashboard', 'admin'):
                filename = 'index.html'
            
            filepath = os.path.join(PUBLIC_DIR, filename)
            
            if not os.path.abspath(filepath).startswith(os.path.abspath(PUBLIC_DIR)):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b"Access Denied")
                return
            
            if os.path.exists(filepath) and os.path.isfile(filepath):
                content_type = 'text/html'
                if filepath.endswith('.css'):
                    content_type = 'text/css'
                elif filepath.endswith('.js'):
                    content_type = 'application/javascript'
                elif filepath.endswith('.png'):
                    content_type = 'image/png'
                elif filepath.endswith('.jpg') or filepath.endswith('.jpeg'):
                    content_type = 'image/jpeg'
                elif filepath.endswith('.svg'):
                    content_type = 'image/svg+xml'
                
                self.send_response(200)
                self.send_header('Content-Type', f'{content_type}; charset=utf-8')
                self.end_headers()
                with open(filepath, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"File Not Found")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        if not path.startswith('/api/'):
            return self.send_error_json("Only API POST requests supported", 400)
            
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            body = json.loads(post_data) if post_data else {}
        except json.JSONDecodeError:
            return self.send_error_json("Invalid JSON body", 400)
            
        # --- API Endpoints ---
        if path == '/api/login':
            username = body.get('username')
            password = body.get('password')
            
            if not username or not password:
                return self.send_error_json("กรุณากรอกผู้ใช้งานและรหัสผ่าน")
                
            conn = get_db_connection()
            user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            conn.close()
            
            # Secure password check
            if user and check_password(user['password'], password):
                user_dict = dict(user)
                del user_dict['password']
                
                # Generate signed token
                token = generate_token(user['id'], user['role'])
                user_dict['token'] = token
                return self.send_json(user_dict)
            else:
                return self.send_error_json("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401)
                
        elif path == '/api/register':
            username = body.get('username')
            password = body.get('password')
            name = body.get('name')
            role = body.get('role', 'employee')
            department = body.get('department')
            
            if not username or not password or not name or not department:
                return self.send_error_json("กรุณากรอกข้อมูลให้ครบถ้วน")
                
            if role not in ('employee', 'manager', 'hr'):
                return self.send_error_json("บทบาทผู้ใช้งานไม่ถูกต้อง")
                
            # Secure password hashing before DB storage
            hashed_pw = hash_password(password)
            
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO users (username, password, name, role, department) VALUES (?, ?, ?, ?, ?)",
                    (username, hashed_pw, name, role, department)
                )
                conn.commit()
                user_id = cursor.lastrowid
                
                new_user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                user_dict = dict(new_user)
                del user_dict['password']
                
                # Generate token for registration success auto-login
                token = generate_token(new_user['id'], new_user['role'])
                user_dict['token'] = token
                return self.send_json(user_dict, 201)
            except sqlite3.IntegrityError:
                return self.send_error_json("ชื่อผู้ใช้งานนี้มีอยู่ในระบบแล้ว")
            finally:
                conn.close()

        # Auth required endpoints below
        user = self.get_authorized_user()
        if not user:
            return self.send_error_json("Unauthorized: โทเค็นไม่ถูกต้องหรือหมดอายุ", 401)
            
        if path == '/api/leaves':
            leave_type = body.get('leave_type')
            start_date = body.get('start_date')
            end_date = body.get('end_date')
            leave_period = body.get('leave_period', 'full')
            reason = body.get('reason', '')
            attachment_data = body.get('attachment_data')
            attachment_name = body.get('attachment_name')
            
            if not leave_type or not start_date or not end_date:
                return self.send_error_json("กรุณากรอกประเภทการลา วันที่เริ่มต้น และวันที่สิ้นสุด")
                
            if leave_type not in ('sick', 'personal', 'vacation'):
                return self.send_error_json("ประเภทการลาไม่ถูกต้อง")
                
            if leave_period not in ('full', 'morning', 'afternoon'):
                return self.send_error_json("ช่วงเวลาการลาไม่ถูกต้อง")
                
            try:
                start_dt = datetime.strptime(start_date, '%Y-%m-%d')
                end_dt = datetime.strptime(end_date, '%Y-%m-%d')
            except ValueError:
                return self.send_error_json("รูปแบบวันที่ไม่ถูกต้อง ต้องเป็น YYYY-MM-DD")
                
            if start_dt > end_dt:
                return self.send_error_json("วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด")
                
            if leave_period != 'full' and start_date != end_date:
                return self.send_error_json("สำหรับการลาครึ่งวัน วันที่เริ่มต้นและวันที่สิ้นสุดต้องเป็นวันเดียวกัน")
                
            if leave_period == 'full':
                duration = float((end_dt - start_dt).days + 1)
            else:
                duration = 0.5
                
            if leave_type == 'sick' and duration >= 3.0 and not attachment_data:
                return self.send_error_json("กรุณาแนบใบรับรองแพทย์สําหรับการลาป่วยตั้งแต่ 3 วันขึ้นไป")
                
            attachment_path = None
            if attachment_data and attachment_name:
                try:
                    os.makedirs(UPLOADS_DIR, exist_ok=True)
                    header, base64_str = attachment_data.split(',', 1)
                    file_bytes = base64.b64decode(base64_str)
                    
                    filename = f"{int(datetime.now().timestamp())}_{attachment_name}"
                    save_path = os.path.join(UPLOADS_DIR, filename)
                    
                    with open(save_path, 'wb') as f:
                        f.write(file_bytes)
                        
                    attachment_path = f"/uploads/{filename}"
                except Exception as e:
                    return self.send_error_json(f"เกิดข้อผิดพลาดในการอัปโหลดไฟล์แนบ: {str(e)}")
                    
            conn = get_db_connection()
            current_year = datetime.now().strftime('%Y')
            
            row = conn.execute(f"""
                SELECT SUM(leave_duration)
                FROM leaves
                WHERE user_id = ? AND leave_type = ? AND status = 'approved'
                  AND (start_date LIKE '{current_year}-%' OR end_date LIKE '{current_year}-%')
            """, (user['id'], leave_type)).fetchone()
            used = row[0] if row[0] is not None else 0
            limit = user[f'{leave_type}_leave_limit']
            remaining = limit - used
            
            if duration > remaining:
                conn.close()
                return self.send_error_json(f"จำนวนวันลาประเภทนี้คงไม่เพียงพอ (ต้องการ {duration} วัน, คงเหลือ {remaining} วัน)")
                
            overlap = conn.execute("""
                SELECT COUNT(*) FROM leaves
                WHERE user_id = ? AND status NOT IN ('rejected', 'cancelled')
                  AND NOT (end_date < ? OR start_date > ?)
            """, (user['id'], start_date, end_date)).fetchone()[0]
            
            if overlap > 0:
                conn.close()
                return self.send_error_json("คุณยื่นใบลาทับซ้อนกับใบลาเดิมที่มีอยู่แล้ว")
                
            cursor = conn.cursor()
            created_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute(
                """INSERT INTO leaves (user_id, leave_type, start_date, end_date, reason, status, created_at, leave_duration, leave_period, attachment_path, attachment_name)
                   VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)""",
                (user['id'], leave_type, start_date, end_date, reason, created_at, duration, leave_period, attachment_path, attachment_name)
            )
            conn.commit()
            conn.close()
            return self.send_json({"message": "ยื่นคำขอลางานสำเร็จแล้ว"}, 201)
            
        elif path == '/api/leaves/action':
            # Strict RBAC Guard: Only Manager or HR can approve/reject
            if user['role'] not in ('manager', 'hr'):
                return self.send_error_json("Forbidden: ไม่มีสิทธิ์จัดการอนุมัติใบลา", 403)
                
            leave_id = body.get('leave_id')
            action_status = body.get('status')
            rejection_reason = body.get('rejection_reason', '')
            
            if not leave_id or action_status not in ('approved', 'rejected'):
                return self.send_error_json("กรุณากรอกรหัสใบลา และสถานะที่ต้องการเปลี่ยน (approved/rejected)")
                
            conn = get_db_connection()
            leave_req = conn.execute("SELECT * FROM leaves WHERE id = ?", (leave_id,)).fetchone()
            if not leave_req:
                conn.close()
                return self.send_error_json("ไม่พบใบลาที่ระบุ", 404)
                
            current_status = leave_req['status']
            
            new_status = None
            if action_status == 'rejected':
                new_status = 'rejected'
            else:
                if user['role'] == 'manager':
                    # Manager level 1 approval
                    if current_status == 'pending':
                        new_status = 'pending_hr'
                    else:
                        conn.close()
                        return self.send_error_json("ใบลานี้พิจารณาไปแล้วหรือไม่อยู่ในเงื่อนไขการอนุมัติระดับหัวหน้างาน")
                elif user['role'] == 'hr':
                    # HR level 2 final approval
                    if current_status in ('pending', 'pending_hr'):
                        new_status = 'approved'
                    else:
                        conn.close()
                        return self.send_error_json("ใบลานี้ไม่สามารถอนุมัติได้ในขณะนี้")
            
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE leaves SET status = ?, approved_by = ?, rejection_reason = ? WHERE id = ?",
                (new_status, user['id'], rejection_reason if action_status == 'rejected' else None, leave_id)
            )
            conn.commit()
            conn.close()
            return self.send_json({"message": f"ดำเนินการใบลาเรียบร้อยแล้ว: สถานะเปลี่ยนเป็น {new_status}"})
            
        elif path == '/api/leaves/cancel':
            leave_id = body.get('leave_id')
            if not leave_id:
                return self.send_error_json("กรุณาระบุรหัสใบลาที่ต้องการยกเลิก")
                
            conn = get_db_connection()
            leave_req = conn.execute("SELECT * FROM leaves WHERE id = ?", (leave_id,)).fetchone()
            
            if not leave_req:
                conn.close()
                return self.send_error_json("ไม่พบใบลาที่ระบุ", 404)
                
            # Verify owner integrity in backend
            if leave_req['user_id'] != user['id']:
                conn.close()
                return self.send_error_json("Forbidden: คุณไม่มีสิทธิ์ยกเลิกใบลาของผู้อื่น", 403)
                
            status = leave_req['status']
            start_date = leave_req['start_date']
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            today_dt = datetime.combine(datetime.now().date(), datetime.min.time())
            
            eligible = False
            if status in ('pending', 'pending_hr'):
                eligible = True
            elif status == 'approved' and start_dt > today_dt:
                eligible = True
                
            if not eligible:
                conn.close()
                return self.send_error_json("ไม่สามารถยกเลิกคำขอลานี้ได้ เนื่องจากใบลาได้รับการพิจารณาไปแล้ว หรือวันลาได้เริ่มต้นขึ้นแล้ว")
                
            cursor = conn.cursor()
            cursor.execute("UPDATE leaves SET status = 'cancelled' WHERE id = ?", (leave_id,))
            conn.commit()
            conn.close()
            return self.send_json({"message": "ยกเลิกคำขอลางานเรียบร้อยแล้ว"})
            
        elif path == '/api/users/update_entitlements':
            # Strict RBAC Guard: Only HR role allowed
            if user['role'] != 'hr':
                return self.send_error_json("Forbidden: ไม่มีสิทธิ์แก้ไขสิทธิ์การลางาน (ต้องเป็นสิทธิ์ HR เท่านั้น)", 403)
                
            target_user_id = body.get('user_id')
            sick_limit = body.get('sick_limit')
            personal_limit = body.get('personal_limit')
            vacation_limit = body.get('vacation_limit')
            
            if target_user_id is None or sick_limit is None or personal_limit is None or vacation_limit is None:
                return self.send_error_json("กรุณากรอกข้อมูลรหัสพนักงาน และสิทธิ์วันลาให้ครบถ้วน")
                
            conn = get_db_connection()
            target_user = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
            if not target_user:
                conn.close()
                return self.send_error_json("ไม่พบรายชื่อพนักงานที่ระบุ", 404)
                
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE users 
                SET sick_leave_limit = ?, personal_leave_limit = ?, vacation_leave_limit = ?
                WHERE id = ?
            """, (sick_limit, personal_limit, vacation_limit, target_user_id))
            conn.commit()
            conn.close()
            return self.send_json({"message": "อัปเดตสิทธิ์การลางานของพนักงานสำเร็จแล้ว"})
            
        else:
            return self.send_error_json("API Endpoint Not Found", 404)

def run():
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    init_db()
    
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, APIRequestHandler)
    print(f"Starting server on http://localhost:{PORT}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    run()
