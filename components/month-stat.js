import { Store, fmtMoney, todayStr } from '../shared/store.js';

function isTaughtOrMakeup(s) {
  return s.status === 'taught' || s.status === 'makeup' || s.status === 'partial';
}
function actualSlots(s) {
  return Number(s.actualSlots ?? s.plannedSlots ?? s.duration ?? 1);
}
function formatNumber(n) {
  return Number(n).toLocaleString('vi-VN');
}
function formatToday(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function _draw(el) {
  const students = Store.get('students');
  const sessions = Store.get('sessions');
  const debts    = (Store.get('debts') || []).filter(d => !d.done);

  const now   = new Date();
  const today = todayStr();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const label = `Tháng ${month + 1}/${year}`;

  const monthSessions = sessions.filter(s => s.date >= start && s.date <= today);
  const taught = monthSessions.filter(isTaughtOrMakeup);

  const totalSlots  = taught.reduce((sum, s) => sum + actualSlots(s), 0);
  const totalIncome = taught.reduce((sum, sess) => {
    const st = students.find(s => s.id === sess.studentId);
    return sum + ((st?.feePerSlot || sess.feePerSlot || 0) * actualSlots(sess));
  }, 0);
  const debtSlots   = debts.reduce((sum, d) => sum + Number(d.slots || 0), 0);

  // Ca chưa chấm: dùng đúng công thức của week-attendance
  // c.scheduled && !c.session?.status && !isFutureDate(c.date.str)
  const activeStudents = students.filter(s => s.status !== 'inactive' && s.status !== 'stopped');
  let pendingCount = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) break;          // qua tháng khác → dừng
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr > today) break;                  // chưa đến hôm nay → dừng
    const dow = d.getDay();
    for (const st of activeStudents) {
      const scheduled = (st.schedDays || []).includes(dow);
      if (!scheduled) continue;
      const sess = sessions.find(s => s.studentId === st.id && s.date === dateStr);
      if (!sess || !sess.status || sess.status === 'pending') pendingCount++;
    }
  }

  const activeStudentCount = students.filter(s => s.status !== 'stopped').length;

  el.innerHTML = `
    <section class="month-stat-section" aria-label="Tổng quan tháng này">
      <div class="month-overview-head">
        <div>
          <div class="section-label">Tổng quan tháng này</div>
          <h2>${label}</h2>
          <p>Tính đến hôm nay · ${formatToday(now)}</p>
        </div>
      </div>
      <div class="month-stat-grid">
        <div class="month-stat-card violet">
          <div class="month-stat-value">${activeStudentCount}</div>
          <div class="month-stat-label">Bé đang dạy</div>
        </div>
        <div class="month-stat-card green">
          <div class="month-stat-value">${formatNumber(totalSlots)}</div>
          <div class="month-stat-label">Ca đã học</div>
        </div>
        <div class="month-stat-card blue">
          <div class="month-stat-value">${formatNumber(pendingCount)}</div>
          <div class="month-stat-label">Ca chưa chấm</div>
        </div>
        <div class="month-stat-card red">
          <div class="month-stat-value">${formatNumber(debtSlots)}</div>
          <div class="month-stat-label">Ca còn nợ</div>
        </div>
        <div class="month-stat-card amber">
          <div class="month-stat-value">${fmtMoney(totalIncome)}</div>
          <div class="month-stat-label">Thu nhập tạm tính</div>
        </div>
      </div>
    </section>`;
}

export function render(el) {
  _draw(el);
  Store.subscribe('sessions', () => _draw(el));
  Store.subscribe('students', () => _draw(el));
  Store.subscribe('debts',    () => _draw(el));
}
