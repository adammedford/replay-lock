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

/** Change only the selected callable's result, evaluating its original expression first. */
export function seedReturnRegression(source, locator, ts) {
  const file=ts.createSourceFile(locator.module,source,ts.ScriptTarget.Latest,true,locator.module.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  let target;
  function find(node,owners=[]){
    if(ts.isFunctionLike(node)&&node.body){
      const bound=node.name??(ts.isVariableDeclaration(node.parent)?node.parent.name:undefined);
      const name=bound&&ts.isIdentifier(bound)?bound.text:undefined;
      const current=name?[...owners,name]:owners;
      if(name&&JSON.stringify(current)===JSON.stringify(locator.namePath))target=node;
      ts.forEachChild(node,child=>find(child,current));
    }else ts.forEachChild(node,child=>find(child,owners));
  }
  find(file);if(!target)return undefined;
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
