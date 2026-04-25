import { defineLayout } from '@directus/extensions-sdk';
import LayoutComponent from './layout.vue';

export default defineLayout({
	id: 'video-cards',
	name: 'Video Cards',
	icon: 'play_circle',
	component: LayoutComponent,
	slots: {
		options: () => null,
		sidebar: () => null,
		actions: () => null,
	},
	setup() {
		return {};
	},
});
