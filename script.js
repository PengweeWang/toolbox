// 加载工具配置文件并渲染页面
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 加载配置文件
        const response = await fetch('tools-config.json');
        if (!response.ok) throw new Error('配置文件加载失败');
        const config = await response.json();

        // 渲染分类标签
        renderCategoryTags(config.categories);
        
        // 渲染所有工具卡片
        renderToolCards(config.tools);
        
        // 绑定分类筛选事件
        bindFilterEvents(config.tools);

    } catch (error) {
        document.getElementById('toolsGrid').innerHTML = `<div class="loading">加载失败：${error.message}</div>`;
        console.error('加载配置文件出错：', error);
    }
});

// 渲染分类标签
function renderCategoryTags(categories) {
    const tagsContainer = document.getElementById('filterTags');
    
    categories.forEach(category => {
        const btn = document.createElement('button');
        btn.className = 'tag-btn';
        btn.dataset.category = category;
        btn.textContent = category;
        tagsContainer.appendChild(btn);
    });
}

// 渲染工具卡片
function renderToolCards(tools) {
    const gridContainer = document.getElementById('toolsGrid');
    gridContainer.innerHTML = ''; // 清空加载提示

    if (tools.length === 0) {
        gridContainer.innerHTML = '<div class="loading">暂无工具数据</div>';
        return;
    }

    tools.forEach(tool => {
        const card = document.createElement('div');
        card.className = 'tool-card';
        card.dataset.category = tool.category;
        
        card.innerHTML = `
            <a href="${tool.url}" target="_blank" rel="noopener noreferrer">
                <div class="tool-header">
                    <div class="tool-icon">
                        <i class="${tool.icon}"></i>
                    </div>
                    <h3 class="tool-title">${tool.title}</h3>
                    <span class="tool-category">${tool.category}</span>
                </div>
                <div class="tool-body">
                    <p class="tool-desc">${tool.description}</p>
                    <span class="tool-link">
                        访问工具 <i class="fas fa-external-link-alt"></i>
                    </span>
                </div>
            </a>
        `;

        gridContainer.appendChild(card);
    });
}

// 绑定分类筛选事件
function bindFilterEvents(allTools) {
    const tagButtons = document.querySelectorAll('.tag-btn');
    
    tagButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // 切换激活状态
            tagButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 获取筛选分类
            const selectedCategory = btn.dataset.category;
            
            // 筛选并重新渲染工具
            let filteredTools = allTools;
            if (selectedCategory !== 'all') {
                filteredTools = allTools.filter(tool => tool.category === selectedCategory);
            }
            
            renderToolCards(filteredTools);
        });
    });
}