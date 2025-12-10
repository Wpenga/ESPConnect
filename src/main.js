import { createApp } from 'vue';
import App from './App.vue';

import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

import '@mdi/font/css/materialdesignicons.css';
import './style.css';

// 导入国际化相关
import { createI18n } from 'vue-i18n';
import en from './locales/en';
import zh from './locales/zh';

const vuetify = createVuetify({
  components,
  directives,
});

// 创建i18n实例
const i18n = createI18n({
  legacy: false,
  locale: 'zh', // 默认语言为中文
  messages: {
    en,
    zh
  }
});

createApp(App).use(vuetify).use(i18n).mount('#app');
