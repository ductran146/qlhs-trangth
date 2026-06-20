/**
 * QLHS Debug Tool — paste vào Console của browser (F12 → Console)
 * Chạy trên trang bất kỳ của app (checkin, students...)
 *
 * Sẽ in ra:
 * 1. Trạng thái Auth + Firestore sync
 * 2. Pending writes queue
 * 3. Thử ghi 1 document test lên Firestore và báo kết quả
 */
(async () => {
  const log = (icon, msg, data) => {
    if (data !== undefined) console.log(icon, msg, data);
    else console.log(icon, msg);
  };

  console.group('%c🔍 QLHS Debug Tool', 'font-size:14px;font-weight:bold;color:#7C6EF8');

  // ── 1. Store sync status ───────────────────────────────────────
  try {
    const { Store } = await import('./shared/store.js').catch(() =>
      import('../shared/store.js')
    );
    const status = Store.getSyncStatus();
    log('🔐', 'Auth status:',       status.auth);
    log('☁️', 'Firestore status:',  status.firestore);
    log('📦', 'Data source:',       status.source);
    log('🔑', 'Teacher ID (uid):',  status.teacherId || '❌ NULL — chưa đăng nhập');
    log('⚡', 'Firebase ready:',    status.firebaseReady);
    log('📸', 'First snapshots:',   status.firstSnapshot);
    log('📝', 'Pending writes:',    status.pendingWrites);
    log('🗑️', 'Pending deletes:',  status.pendingDeletes);
    if (status.error) log('❌', 'Last error:', status.error);

    const students = Store.get('students');
    log('👦', `Students in cache: ${students.length}`, students.map(s => s.name));

    // ── 2. Pending queue từ localStorage ─────────────────────────
    const pendingRaw = localStorage.getItem('nkct_pending_doc_writes');
    const pending = pendingRaw ? JSON.parse(pendingRaw) : [];
    log('🕐', `Pending writes in localStorage: ${pending.length}`, pending.map(e => `${e.key}/${e.item?.id} (${e.item?.name || '?'})`));

    // ── 3. Thử ghi test document lên Firestore ───────────────────
    if (!status.teacherId) {
      log('⛔', 'Không thể test Firestore — chưa đăng nhập');
      console.groupEnd();
      return;
    }

    log('🧪', 'Đang thử ghi test document lên Firestore...');
    const { db, doc, setDoc, deleteDoc } = await import('./shared/firebase.js').catch(() =>
      import('../shared/firebase.js')
    );

    const testDocRef = doc(db, 'teachers', status.teacherId, '_debug', 'test');
    const testData = { _test: true, ts: new Date().toISOString() };

    try {
      await setDoc(testDocRef, testData);
      log('✅', 'setDoc thành công — Firestore rules OK, ghi được');

      // Cleanup
      await deleteDoc(testDocRef);
      log('🧹', 'Test document đã xóa');

      // ── 4. Thử ghi student thật ────────────────────────────────
      log('🧪', 'Thử ghi 1 student test...');
      const { uid } = await import('./shared/store.js').catch(() =>
        import('../shared/store.js')
      );
      const testId = 'debug_' + Date.now();
      const studentRef = doc(db, 'teachers', status.teacherId, 'students', testId);
      await setDoc(studentRef, { id: testId, name: '🧪 Debug Test', _debug: true });
      log('✅', 'Student test ghi thành công');
      await deleteDoc(studentRef);
      log('🧹', 'Student test đã xóa');

      log('🎉', 'KẾT LUẬN: Firestore hoạt động đúng. Vấn đề nằm ở code store/modal.');

    } catch (firestoreErr) {
      log('❌', 'setDoc THẤT BẠI:', firestoreErr.code || firestoreErr.message);
      if (firestoreErr.code === 'permission-denied') {
        log('🚨', 'NGUYÊN NHÂN: Firestore Security Rules chặn ghi!');
        log('📋', 'Vào Firebase Console → Firestore → Rules và paste rules này:',
          `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /teachers/{teacherId}/{collection}/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == teacherId;
    }
  }
}`
        );
      } else if (firestoreErr.code === 'unauthenticated') {
        log('🚨', 'NGUYÊN NHÂN: Firebase Auth token hết hạn hoặc chưa đăng nhập');
      } else {
        log('🚨', 'NGUYÊN NHÂN KHÁC:', firestoreErr);
      }
    }

  } catch (importErr) {
    log('❌', 'Không import được store.js:', importErr.message);
    log('💡', 'Chắc chắn bạn đang chạy từ trang của app (không phải file:// local)');
  }

  console.groupEnd();
})();
