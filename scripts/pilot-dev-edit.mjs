/** Wire the pinned application's existing HTTP listener into Vite middleware mode. */
export function attachEpicMiddlewareHost(source) {
  const replacements = [
    ["const app = express()", "const app = express()\nconst replaylockPilotHttpServer = createReplaylockPilotHttpServer(app)"],
    ["server: { middlewareMode: true }", "server: { middlewareMode: { server: replaylockPilotHttpServer }, hmr: { server: replaylockPilotHttpServer } }"],
    ["const server = app.listen(portToUse, () => {", "const server = replaylockPilotHttpServer.listen(portToUse, '127.0.0.1', () => {"],
  ];
  if (source.includes('replaylockPilotHttpServer')) throw new Error('PILOT_HOST_SOURCE_CHANGED');
  let output = source;
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('PILOT_HOST_SOURCE_CHANGED');
    output = output.replace(before, after);
  }
  return "import { createServer as createReplaylockPilotHttpServer } from 'node:http'\n" + output;
}

const callableName=(node,ts)=>{const bound=node.name??(ts.isVariableDeclaration(node.parent)?node.parent.name:undefined);return bound&&ts.isIdentifier(bound)?bound.text:undefined;};
/** The function the locator names: a declaration or a variable-bound function, addressed by its owner chain. */
function findCallable(source,locator,ts){
  const file=ts.createSourceFile(locator.module,source,ts.ScriptTarget.Latest,true,locator.module.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  let target;
  function find(node,owners=[]){
    if(ts.isFunctionLike(node)&&node.body){
      const name=callableName(node,ts);
      const current=name?[...owners,name]:owners;
      if(name&&JSON.stringify(current)===JSON.stringify(locator.namePath))target=node;
      ts.forEachChild(node,child=>find(child,current));
    }else ts.forEachChild(node,child=>find(child,owners));
  }
  find(file);
  return {file,target};
}

/** Change only the selected callable's result, evaluating its original expression first. */
export function seedReturnRegression(source, locator, ts) {
  const {file,target}=findCallable(source,locator,ts);
  if(!target)return undefined;
  const asynchronous=target.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword);
  const expressions=[];
  function returns(node){
    if(ts.isFunctionLike(node))return;
    if(ts.isReturnStatement(node)&&node.expression)expressions.push(node.expression);
    else ts.forEachChild(node,returns);
  }
  if(ts.isBlock(target.body))returns(target.body);else expressions.push(target.body);
  // An async return of an unawaited call needs an application-specific edit to
  // preserve its joining behavior. Do not turn it into detached work.
  if(!expressions.length||asynchronous&&expressions.some(expression=>ts.isCallExpression(expression)))return undefined;
  let changed=source;
  for(const expression of expressions.sort((a,b)=>b.getStart(file)-a.getStart(file)))changed=changed.slice(0,expression.getStart(file))+`((${expression.getText(file)}), void 0)`+changed.slice(expression.end);
  return changed;
}

const FLIPPED_OPERATORS=new Map([['===','!=='],['!==','==='],['==','!='],['!=','=='],['<','>='],['>=','<'],['>','<='],['<=','>'],['&&','||'],['||','&&']]);
/**
 * Bounded logic mutants of the selected callable, one change each, in syntax
 * tree order: a flipped comparison or logical operator, swapped conditional
 * branches, a changed string or numeric literal. Parameter defaults, property
 * keys, module specifiers, type positions and nested named functions (separate
 * capture units) are left alone.
 * Returns an empty list for a callable without mutable logic, and undefined
 * when the locator names no function.
 */
export function generateLogicMutants(source, locator, ts) {
  const {file,target}=findCallable(source,locator,ts);
  if(!target)return undefined;
  const mutants=[];
  const text=node=>node.getText(file);
  const record=(node,kind,before,after,changed)=>{const {line,character}=file.getLineAndCharacterOfPosition(node.getStart(file));mutants.push({kind,line:line+1,column:character+1,before,after,source:changed});};
  const replace=(node,kind,before,after)=>record(node,kind,before,after,source.slice(0,node.getStart(file))+after+source.slice(node.end));
  const named=node=>ts.isPropertyAssignment(node)||ts.isShorthandPropertyAssignment(node)||ts.isMethodDeclaration(node)||ts.isPropertyDeclaration(node)||ts.isEnumMember(node)||ts.isComputedPropertyName(node);
  const propertyKey=node=>!!node.parent&&named(node.parent)&&(ts.isComputedPropertyName(node.parent)||node.parent.name===node);
  const moduleSpecifier=node=>!!node.parent&&ts.isCallExpression(node.parent)&&node.parent.arguments[0]===node&&(node.parent.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.parent.expression)&&node.parent.expression.text==='require'));
  function visit(node){
    // Types are erased before verify runs; a nested named function is its own capture unit.
    if(ts.isTypeNode(node)||(node!==target&&ts.isFunctionLike(node)&&callableName(node,ts)))return;
    if(ts.isBinaryExpression(node)){
      const operator=node.operatorToken.getText(file),flipped=FLIPPED_OPERATORS.get(operator);
      if(flipped)replace(node.operatorToken,['&&','||'].includes(operator)?'logical':'comparison',operator,flipped);
    }else if(ts.isConditionalExpression(node)){
      const swapped=`${text(node.condition)}?${text(node.whenFalse)}:${text(node.whenTrue)}`;
      replace(node,'branch',text(node),swapped);
    }else if(ts.isIfStatement(node)&&node.elseStatement&&!ts.isIfStatement(node.elseStatement)){
      const {thenStatement,elseStatement}=node;
      const swapped=source.slice(0,thenStatement.getStart(file))+text(elseStatement)+source.slice(thenStatement.end,elseStatement.getStart(file))+text(thenStatement)+source.slice(elseStatement.end);
      record(node,'branch',`${text(thenStatement)} else ${text(elseStatement)}`,`${text(elseStatement)} else ${text(thenStatement)}`,swapped);
    }else if(ts.isStringLiteral(node)&&!propertyKey(node)&&!moduleSpecifier(node)){
      const raw=text(node);replace(node,'string',raw,`${raw.slice(0,-1)}_mutant${raw.at(-1)}`);
    }else if(ts.isNoSubstitutionTemplateLiteral(node)){
      const raw=text(node);replace(node,'string',raw,`${raw.slice(0,-1)}_mutant\``);
    }else if(ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
      const raw=text(node),close=ts.isTemplateTail(node)?1:2;
      if(node.text)replace(node,'string',raw,`${raw.slice(0,-close)}_mutant${raw.slice(-close)}`);
    }else if(ts.isNumericLiteral(node)&&!propertyKey(node)){
      const raw=text(node);replace(node,'number',raw,`(${raw} + 1)`);
    }
    ts.forEachChild(node,visit);
  }
  visit(target.body);
  return mutants;
}
