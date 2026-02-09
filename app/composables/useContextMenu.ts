export default function (menuId: any, template: ComputedRef<any[]>) {
  const menu = computed(() => template.value.filter(Boolean));

  onMounted(() => {
    handleContextMenuItemClick();
  });

  function findMenuItem(menu: any[], indexes: number[]) {
    const i = indexes.shift();
    const item = i !== undefined ? menu[i] : null;
    if (item && item.submenu && indexes.length) {
      return findMenuItem(item.submenu, indexes);
    }
    return item || null;
  }

  function handleContextMenuItemClick() {
    window.addEventListener('message', e => {
      if (e.source === window && e.data?.type === 'click-context-menu-item' && e.data.payload?.key === menuId) {
        const indexes = (e.data.payload.indexes || '').split('.');        
        const menuItem = findMenuItem(menu.value, indexes);
        if (menuItem && menuItem.click) {
          menuItem.click();
        }
      }
    });
  }

  return {
    onContextMenu(e: any) {
      if (!menu.value?.length) return;
      if ('$electron' in window) {
        // @ts-ignore window.$electron
        $electron.showContextMenu({
          key: menuId,
          val: JSON.parse(JSON.stringify(menu.value)),
          x: e.x,
          y: e.y,
        });
      }
    },
  };
}
