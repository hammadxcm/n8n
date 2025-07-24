import { useStorage } from '@/composables/useStorage';
import { useTelemetry } from '@/composables/useTelemetry';
import {
	LOCAL_STORAGE_EXPERIMENTAL_DISMISSED_SUGGESTED_WORKFLOWS,
	TEMPLATE_ONBOARDING_EXPERIMENT,
	VIEWS,
} from '@/constants';
import { useCloudPlanStore } from '@/stores/cloudPlan.store';
import { usePostHog } from '@/stores/posthog.store';
import { useTemplatesStore } from '@/stores/templates.store';
import type { ITemplatesWorkflowFull } from '@n8n/rest-api-client';
import { STORES } from '@n8n/stores';
import { jsonParse } from 'n8n-workflow';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const SIMPLE_TEMPLATES = [6035, 1960, 2178];

const PREDEFINED_TEMPLATES_BY_NODE = {
	googleSheets: [5694, 5690, 5906],
	gmail: [5678, 4722, 5694],
	telegram: [5626, 5784, 4875],
	openAi: [2462, 2722, 2178],
	googleGemini: [5993, 6035, 5677],
	googleCalendar: [2328, 3393, 3657],
	youTube: [3188, 4846, 4506],
	airtable: [3053, 2700, 2579],
};

function getPredefinedFromSelected(selectedApps: string[]) {
	const predefinedNodes = Object.keys(PREDEFINED_TEMPLATES_BY_NODE);
	const predefinedSelected = predefinedNodes.filter((node) => selectedApps.includes(node));

	return predefinedSelected.reduce<number[]>(
		(acc, app) => [
			...acc,
			...PREDEFINED_TEMPLATES_BY_NODE[app as keyof typeof PREDEFINED_TEMPLATES_BY_NODE],
		],
		[],
	);
}

function getSuggestedTemplatesForLowCodingSkill(selectedApps: string[]) {
	if (selectedApps.length === 0) {
		return SIMPLE_TEMPLATES;
	}

	const predefinedSelected = getPredefinedFromSelected(selectedApps);
	if (predefinedSelected.length > 0) {
		return predefinedSelected;
	}

	return [];
}

function keepTop3Templates(templates: ITemplatesWorkflowFull[]) {
	if (templates.length <= 3) {
		return templates;
	}

	return Array.from(new Map(templates.map((t) => [t.id, t])).values())
		.sort((a, b) => a.totalViews - b.totalViews)
		.slice(0, 3);
}

export const usePersonalizedTemplatesStore = defineStore(STORES.PERSONALIZED_TEMPLATES, () => {
	const telemetry = useTelemetry();
	const posthogStore = usePostHog();
	const cloudPlanStore = useCloudPlanStore();
	const templatesStore = useTemplatesStore();

	const allSuggestedWorkflows = ref<ITemplatesWorkflowFull[]>([]);
	const dismissedSuggestedWorkflowsStorage = useStorage(
		LOCAL_STORAGE_EXPERIMENTAL_DISMISSED_SUGGESTED_WORKFLOWS,
	);
	const dismissedSuggestedWorkflows = computed((): number[] => {
		return dismissedSuggestedWorkflowsStorage.value
			? jsonParse(dismissedSuggestedWorkflowsStorage.value, { fallbackValue: [] })
			: [];
	});
	const suggestedWorkflows = computed(() =>
		allSuggestedWorkflows.value.filter(({ id }) => !dismissedSuggestedWorkflows.value.includes(id)),
	);
	const dismissSuggestedWorkflow = (id: number) => {
		dismissedSuggestedWorkflowsStorage.value = JSON.stringify([
			...(dismissedSuggestedWorkflows.value ?? []),
			id,
		]);
	};

	const isFeatureEnabled = () => {
		return (
			(posthogStore.getVariant(TEMPLATE_ONBOARDING_EXPERIMENT.name) ===
				TEMPLATE_ONBOARDING_EXPERIMENT.variantSuggestedTemplates &&
				cloudPlanStore.userIsTrialing) ||
			true
		);
	};

	const trackUserWasRecommendedTemplates = (templateIds: number[]) => {
		telemetry.track('User was recommended personalized templates', {
			templateIds,
		});
	};

	const trackUserClickedOnPersonalizedTemplate = (templateId: number) => {
		telemetry.track('User clicked on personalized template callout', {
			templateId,
		});
	};

	const trackUserDismissedCallout = (templateId: number) => {
		telemetry.track('User dismissed personalized template callout', {
			templateId,
		});
	};

	const fetchSuggestedWorkflows = async () => {
		if (!isFeatureEnabled()) {
			return;
		}

		try {
			const codingSkill = 1; //cloudPlanStore.codingSkill;
			const selectedApps = ['gmail']; //cloudPlanStore.selectedApps;

			if (codingSkill === 1) {
				const predefinedSelected = getSuggestedTemplatesForLowCodingSkill(selectedApps);

				if (predefinedSelected.length > 0) {
					const suggestedWorkflowsPromises = predefinedSelected.map(
						async (id) => await templatesStore.fetchTemplateById(id.toString()),
					);

					const allWorkflows = await Promise.all(suggestedWorkflowsPromises);
					const top3Templates = keepTop3Templates(allWorkflows);
					allSuggestedWorkflows.value = top3Templates;
					trackUserWasRecommendedTemplates(top3Templates.map((t) => t.id));
					return;
				}
			}

			const topWorkflowsByApp = await templatesStore.getWorkflows({
				categories: [],
				search: '',
				sort: 'rank:desc',
				apps: selectedApps.length > 0 ? selectedApps : undefined,
				combineWith: 'or',
			});

			const topWorkflowsIds = topWorkflowsByApp.slice(0, 3).map((workflow) => workflow.id);
			const suggestedWorkflowsPromises = topWorkflowsIds.map(
				async (id) => await templatesStore.fetchTemplateById(id.toString()),
			);

			const allWorkflows = await Promise.all(suggestedWorkflowsPromises);
			const top3Templates = keepTop3Templates(allWorkflows);
			allSuggestedWorkflows.value = top3Templates;
			trackUserWasRecommendedTemplates(top3Templates.map((t) => t.id));
		} catch (error) {
			// Let it fail silently
		}
	};

	const getTemplateRoute = (id: number) => {
		return { name: VIEWS.TEMPLATE, params: { id } };
	};

	return {
		isFeatureEnabled,
		fetchSuggestedWorkflows,
		suggestedWorkflows,
		dismissSuggestedWorkflow,
		trackUserClickedOnPersonalizedTemplate,
		trackUserDismissedCallout,
		getTemplateRoute,
	};
});
