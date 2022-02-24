import * as path from 'path';
import * as fse from 'fs-extra';
import consola from 'consola';
import fg from 'fast-glob';
import * as ejs from 'ejs';
import * as prettier from 'prettier';
import debounce from 'lodash.debounce';
import getRuntimeModules from '../utils/getRuntimeModules';
import formatPath from '../utils/formatPath';

export interface ExportData {
  specifier?: string;
  importSource?: string;
  exportMembers?: string[];
  source: string;
  exportName: string;
}

type RenderDataFunction = (renderDataFunction: RenderData) => RenderData;
type RenderData = Record<string, unknown>;

type ExtraData = RenderData | RenderDataFunction;

interface Registration {
  [key: string]: any[];
}

interface RenderFile {
  (templatePath: string, targetDir: string, extraData?: ExtraData): void;
}

interface RenderDataRegistration {
  (renderDataFunction: RenderData): RenderData;
}

interface TemplateOptions {
  template: string;
  targetDir: string;
}

type RenderTemplate = [string, string, ExtraData];

const RENDER_WAIT = 150;

function generateExports(exportList: ExportData[], isTypes: boolean) {
  const importStatements = [];
  const exportStatements = [];
  exportList.forEach(data => {
    const { specifier, source, exportName } = data;
    if (exportName) {
      let exportStr = exportName;
      if (source) {
        const symbol = source.includes('types') ? ';' : ',';
        importStatements.push(`import ${isTypes ? 'type ' : ''}${specifier || exportName} from '${source}';`);
        exportStr = `${exportName}${symbol}`;
      }
      exportStatements.push(exportStr);
    } else if (source) {
      importStatements.push(`export ${specifier || '*'} from '${source}';`);
    }
  });
  return {
    importStr: importStatements.join('\n'),
    exportStr: exportStatements.join('\n'),
  };
}

function checkExportData(currentList: ExportData[], exportData: ExportData | ExportData[], apiName: string) {
  (Array.isArray(exportData) ? exportData : [exportData]).forEach((data) => {
    currentList.forEach(({ specifier, exportName }) => {
      // check exportName and specifier
      if (specifier || exportName) {
        const defaultSpecifierName = specifier || exportName;
        if ((exportName && exportName === data.exportName) || defaultSpecifierName === data.specifier) {
          throw new Error(`duplicate export data added by ${apiName},
            ${data.exportName ? `exportName: ${data.exportName}, ` : ''}specifier: ${data.specifier}
          `);
        }
      }
    });
  });
}

function removeExportData(exportList: ExportData[], removeExportName: string | string[]) {
  const removeExportNames = Array.isArray(removeExportName) ? removeExportName : [removeExportName];
  return exportList.filter(({ exportName, specifier }) => {
    const needRemove = removeExportNames.includes(exportName) ||
      !exportName && removeExportNames.includes(specifier);
    return !needRemove;
  });
}

export default class Generator {
  private targetDir: string;

  private renderData: RenderData;

  private contentRegistration: Registration;

  private rerender: boolean;

  private rootDir: string;

  private renderTemplates: RenderTemplate[];

  private renderDataRegistration: RenderDataRegistration[];

  private showPrettierError: boolean;

  private disableRuntimePlugins: string[];

  private contentTypes: string[];

  private plugins: any[];

  public constructor({ rootDir, targetDir, defaultData }) {
    this.rootDir = rootDir;
    this.targetDir = targetDir;
    this.renderData = defaultData;
    this.contentRegistration = {};
    this.rerender = false;
    this.showPrettierError = true;
    this.renderTemplates = [];
    this.renderDataRegistration = [];
    this.disableRuntimePlugins = [];
    this.contentTypes = ['framework', 'frameworkTypes', 'configTypes'];
    this.plugins = [];
    // empty .ice before render
    fse.emptyDirSync(path.join(rootDir, targetDir));
  }

  public setPlugins(plugins: any) {
    this.plugins = plugins;
  }

  public debounceRender = debounce(() => {
    this.render();
  }, RENDER_WAIT);

  public addExport = (registerKey: string, exportData: ExportData | ExportData[]) => {
    const exportList = this.contentRegistration[registerKey] || [];
    checkExportData(exportList, exportData, registerKey);
    this.addContent(registerKey, exportData);
  };

  public removeExport = (registerKey: string, removeExportName: string | string[]) => {
    const exportList = this.contentRegistration[registerKey] || [];
    this.contentRegistration[registerKey] = removeExportData(exportList, removeExportName);
  };

  public addContent(apiName: string, ...args: any) {
    if (!this.contentTypes.includes(apiName)) {
      throw new Error(`invalid API ${apiName}`);
    }
    const [data, position] = args;
    if (position && !['before', 'after'].includes(position)) {
      throw new Error(`invalid position ${position}, use before|after`);
    }
    const registerKey = position ? `${apiName}_${position}` : apiName;
    if (!this.contentRegistration[registerKey]) {
      this.contentRegistration[registerKey] = [];
    }
    const content = Array.isArray(data) ? data : [data];
    this.contentRegistration[registerKey].push(...content);
  }

  private getExportStr(registerKey: string, dataKeys: string[]) {
    const exportList = this.contentRegistration[registerKey] || [];
    const isTypes = registerKey.endsWith('Types');
    const { importStr, exportStr } = generateExports(exportList, isTypes);
    const [importStrKey, exportStrKey] = dataKeys;
    return {
      [importStrKey]: importStr,
      [exportStrKey]: exportStr,
    };
  }

  public parseRenderData(): RenderData {
    const staticConfig = fg.sync(['src/manifest.json'], { cwd: this.rootDir });
    const globalStyles = fg.sync(['src/global.@(scss|less|styl|css)'], { cwd: this.rootDir, absolute: true });
    let exportsData = {};
    this.contentTypes.forEach(item => {
      const data = this.getExportStr(item, ['imports', 'exports']);
      exportsData = Object.assign({}, exportsData, {
        [`${item}`]: data,
      });
    });

    return {
      ...this.renderData,
      ...exportsData,
      staticConfig: staticConfig.length && staticConfig[0],
      globalStyle: globalStyles.length && formatPath(path.relative(path.join(this.targetDir, 'core'), globalStyles[0])),
    };
  }

  public generateImportStr(apiName: string) {
    const imports = this.contentRegistration[apiName] || [];
    return imports.map(({ source, specifier }) => {
      return specifier
        ? `import ${specifier} from '${source}';` : `import '${source}'`;
    }).join('\n');
  }

  public render = () => {
    this.rerender = true;
    this.renderData = this.renderDataRegistration.reduce((previousValue, currentValue) => {
      if (typeof currentValue === 'function') {
        return currentValue(previousValue);
      }
      return previousValue;
    }, this.parseRenderData());
    // 生成所有运行时插件，在 load 阶段判断是否需要加载，确保 index 中的 exports 路径永远可以获取引用
    this.renderData.runtimeModules = getRuntimeModules(this.plugins)
      .filter((plugin) => {
        return !this.disableRuntimePlugins.includes(plugin?.name);
      });

    this.renderTemplates.forEach((args) => {
      this.renderFile(...args);
    });
  };

  public addRenderFile = (templatePath: string, targetPath: string, extraData: ExtraData = {}) => {
    // check target path if it is already been registered
    const renderIndex = this.renderTemplates.findIndex(([, templateTarget]) => templateTarget === targetPath);
    if (renderIndex > -1) {
      const targetTemplate = this.renderTemplates[renderIndex];
      if (targetTemplate[0] !== templatePath) {
        consola.error('[template]', `path ${targetPath} already been rendered as file ${targetTemplate[0]}`);
      }
      // replace template with latest content
      this.renderTemplates[renderIndex] = [templatePath, targetPath, extraData];
    } else {
      this.renderTemplates.push([templatePath, targetPath, extraData]);
    }
    if (this.rerender) {
      this.debounceRender();
    }
  };

  public addTemplateFiles = (templateOptions: string | TemplateOptions, extraData: ExtraData = {}) => {
    const { template, targetDir } = typeof templateOptions === 'string' ? { template: templateOptions, targetDir: '' } : templateOptions;
    const templates = path.extname(template)
      ? [template]
      : fg.sync(['**/*'], { cwd: template });
    templates.forEach((templateFile) => {
      const templatePath = path.isAbsolute(templateFile) ? templateFile : path.join(template, templateFile);
      const filePath = path.isAbsolute(templateFile) ? path.basename(templateFile) : templateFile;
      const targetPath = path.join(this.targetDir, targetDir, filePath);

      this.addRenderFile(templatePath, targetPath, extraData);
    });
    if (this.rerender) {
      this.debounceRender();
    }
  };

  public modifyRenderData(registration: RenderDataRegistration) {
    this.renderDataRegistration.push(registration);
    if (this.rerender) {
      this.debounceRender();
    }
  }

  public renderFile: RenderFile = (templatePath, targetPath, extraData = {}) => {
    const renderExt = '.ejs';
    if (path.extname(templatePath) === '.ejs') {
      const templateContent = fse.readFileSync(templatePath, 'utf-8');
      let renderData = { ...this.renderData };
      if (typeof extraData === 'function') {
        renderData = extraData(this.renderData);
      } else {
        renderData = {
          ...renderData,
          ...extraData,
        };
      }
      let content = ejs.render(templateContent, renderData);
      try {
        content = prettier.format(content, {
          parser: 'typescript',
          singleQuote: true,
        });
      } catch (error) {
        if (this.showPrettierError) {
          consola.warn(`Prettier format error: ${error.message}`);
          this.showPrettierError = false;
        }
      }
      const realTargetPath = targetPath.replace(renderExt, '');
      fse.ensureDirSync(path.dirname(realTargetPath));
      fse.writeFileSync(realTargetPath, content, 'utf-8');
    } else {
      fse.ensureDirSync(path.dirname(targetPath));
      fse.copyFileSync(templatePath, targetPath);
    }
  };

  public addDisableRuntimePlugin = (pluginName: string) => {
    if (!this.disableRuntimePlugins.includes(pluginName)) {
      this.disableRuntimePlugins.push(pluginName);
    }
  };
}