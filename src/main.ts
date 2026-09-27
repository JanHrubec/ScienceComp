import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import LoginView from './views/LoginView.vue'
import ParticipantView from './views/ParticipantView.vue'
import QuestionsView from './views/QuestionsView.vue'
import GridGame from './components/GridGame.vue'
import StandingsView from './views/StandingsView.vue'
import AdminView from './views/AdminView.vue'
import './style.css'
export const router = createRouter({ history: createWebHistory(), scrollBehavior: () => ({ top: 0 }), routes: [
  { path: '/', component: LoginView },
  { path: '/play', component: ParticipantView, children: [{ path: '', redirect: '/play/questions' }, { path: 'questions', component: QuestionsView }, { path: 'game', component: GridGame }, { path: 'standings', component: StandingsView }] },
  { path: '/admin', component: AdminView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
] })
createApp(App).use(router).mount('#app')
