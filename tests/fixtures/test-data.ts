export const testUsers = {
  userA: {
    email: 'test-user-a@example.com',
    password: 'Ekyat1qp',
    name: 'テストユーザーA'
  },
  userB: {
    email: 'test-user-b@example.com', 
    password: 'Ekyat1qp',
    name: 'テストユーザーB'
  }
};

export const testFiles = {
  pdf: {
    name: 'test-manual.txt', // 一時的にテキストファイルを使用
    path: './tests/fixtures/files/test-manual.txt',
    type: 'text/plain'
  },
  word: {
    name: 'test-document.txt',
    path: './tests/fixtures/files/test-manual.txt', // 同じファイルを使い回し
    type: 'text/plain'
  },
  invalidFile: {
    name: 'test-image.jpg',
    path: './tests/fixtures/files/invalid-file.txt', // 存在しないファイル
    type: 'image/jpeg'
  },
  largeFile: {
    name: 'large-file.txt',
    path: './tests/fixtures/files/test-manual.txt',
    type: 'text/plain'
  }
};

export const testQuestions = {
  simple: 'この資料について教えてください',
  specific: '具体的な手順を教えてください',
  complex: '詳細な分析と背景情報を含めて説明してください'
};

export const testMemos = {
  basic: {
    title: 'テストメモ1',
    content: 'これはテスト用のメモです。'
  },
  important: {
    title: '重要なメモ',
    content: '重要フラグ付きのテストメモです。',
    isImportant: true
  }
}; 