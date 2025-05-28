import { jaJP } from '@clerk/localizations';

// カスタムローカライズオブジェクトを定義
export const customJaJp = {
  ...jaJP,
  signIn: {
    ...jaJP.signIn,
    start: {
      ...jaJP.signIn?.start,
      subtitle: 'サインインをして、介護DXに役立つ限定資料やツールを活用しましょう。',
    }
  },
  signUp: {
    ...jaJP.signUp,
    start: {
      ...jaJP.signUp?.start,
      subtitle: 'アカウントを作成し、介護DXに役立つ限定資料やツールを入手しましょう。',
    }
  }
}; 