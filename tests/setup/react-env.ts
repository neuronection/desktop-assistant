import { configure } from '@testing-library/dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof document !== 'undefined') {
  configure({ asyncUtilTimeout: 3_000 });
}

export {};
