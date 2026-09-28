<script setup lang="ts">
// The table primitives follow shadcn/ui's Table one to one (Table, TableHeader, TableBody,
// TableFooter, TableRow, TableHead, TableCell, TableCaption): native elements, one class each, the
// look in styles/base.css under "ui/table". The global `table`/`th`/`td` rules skip `.ui-table`, so
// a table built from these starts clean instead of undoing the sheet's defaults.
//
// `variant`: `lined` (hairline between rows, shadcn's default) or `plain` (rows separated by air,
// hover and selection only; the landing look). `surface` lifts it onto a card.
defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ variant?: 'lined' | 'plain', surface?: boolean }>(), { variant: 'lined', surface: false })
</script>

<template>
  <div class="ui-table-wrap" :class="{ 'ui-table-surface': surface }">
    <table v-bind="$attrs" class="ui-table" :class="'ui-table-' + variant"><slot /></table>
  </div>
</template>
