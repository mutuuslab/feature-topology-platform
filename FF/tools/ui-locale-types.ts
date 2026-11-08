// Check English copy values against the real inferred source types, including formatter object return shapes.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { FF } from './lib.ts';
const copy=join(FF,'frontend/src/copy'), en=join(FF,'frontend/src/locale/en');
const configFile=ts.readConfigFile(join(FF,'frontend/tsconfig.json'),ts.sys.readFile);
if(configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText,' '));
const config=ts.parseJsonConfigFileContent(configFile.config,ts.sys,join(FF,'frontend'));
const files=readdirSync(en).filter(name=>name.endsWith('.ts')&&existsSync(join(copy,name)));
const program=ts.createProgram({rootNames:files.flatMap(name=>[join(copy,name),join(en,name)]),options:{...config.options,noEmit:true}});
const checker=program.getTypeChecker();
function shape(type:ts.Type,seen=new Set<ts.Type>()):string{
  if(type.flags&ts.TypeFlags.StringLike)return 'string';
  if(type.flags&ts.TypeFlags.NumberLike)return 'number';
  if(type.flags&ts.TypeFlags.BooleanLike)return 'boolean';
  if(type.isUnion())return [...new Set(type.types.map(member=>shape(member,seen)))].sort().join('|');
  if(checker.isTupleType(type))return `[${checker.getTypeArguments(type as ts.TypeReference).map(member=>shape(member,seen)).join(',')}]`;
  if(checker.isArrayType(type))return `Array<${checker.getTypeArguments(type as ts.TypeReference).map(member=>shape(member,seen)).join(',')}>`;
  if(seen.has(type))return checker.typeToString(type);
  const signatures=type.getCallSignatures();
  if(signatures.length)return `function:${signatures.map(signature=>shape(checker.getReturnTypeOfSignature(signature),new Set([...seen,type]))).join('|')}`;
  const properties=type.getProperties();
  if(properties.length)return `{${properties.map(property=>`${property.name}${property.flags&ts.SymbolFlags.Optional?'?':''}:${shape(checker.getTypeOfSymbolAtLocation(property,property.valueDeclaration??property.declarations![0]),new Set([...seen,type]))}`).sort().join(',')}}`;
  return checker.typeToString(type);
}
const bad:{module:string;key:string;source:string;translation:string}[]=[];
let checked=0;
for(const name of files){
  const source=program.getSourceFile(join(copy,name))!, translated=program.getSourceFile(join(en,name))!;
  const sourceSymbol=checker.getSymbolAtLocation(source);
  if(!sourceSymbol)continue;
  const exported=new Map(checker.getExportsOfModule(sourceSymbol).map(symbol=>[symbol.name,symbol]));
  for(const statement of translated.statements)if(ts.isExportAssignment(statement)&&ts.isObjectLiteralExpression(statement.expression)){
    for(const property of statement.expression.properties)if(ts.isPropertyAssignment(property)&&ts.isStringLiteralLike(property.name)){
      const [root,...path]=property.name.text.split('.'),symbol=exported.get(root);
      if(!symbol)throw new Error(`Unknown source export ${name}:${property.name.text}`);
      let target:ts.Type|undefined=checker.getTypeOfSymbolAtLocation(symbol,source);
      for(let index=0;index<path.length;){
        let member:ts.Symbol|undefined,length=path.length-index;
        for(;length>0;length--){member=target&&checker.getPropertyOfType(target,path.slice(index,index+length).join('.'));if(member)break;}
        // Numeric-looking string codes such as '01' remain string keys in Record<string, T>.
        const indexed=target?( /^\d+$/.test(path[index]) ? checker.getIndexTypeOfType(target,ts.IndexKind.Number) ?? checker.getIndexTypeOfType(target,ts.IndexKind.String) : checker.getIndexTypeOfType(target,ts.IndexKind.String) ):undefined;
        target=member?checker.getTypeOfSymbolAtLocation(member,source):indexed;
        index+=member?length:target&&(target.flags&(ts.TypeFlags.StringLike|ts.TypeFlags.NumberLike|ts.TypeFlags.BooleanLike))?path.length-index:1;
      }
      if(!target)throw new Error(`Unknown source path ${name}:${property.name.text}`);
      const actual=checker.getTypeAtLocation(property.initializer);
      // Copy literal text is deliberately different. Its primitive and structured return shape must remain the same.
      if(shape(actual)!==shape(target))bad.push({module:basename(name,'.ts'),key:property.name.text,source:shape(target),translation:shape(actual)});
      checked++;
    }
  }
}
console.log(JSON.stringify({checked,invalid:bad.length,details:bad}));
if(bad.length)process.exitCode=1;
