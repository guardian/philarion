package controllers

import matchers.{LanguageToolFactory, RegexMatcher}
import com.gu.pandomainauth.PublicSettings
import model.{Category, RegexRule}
import play.api.mvc._
import rules.{BucketRuleManager, SheetsRuleManager}
import services._

import scala.concurrent.ExecutionContext

/**
 * The controller that handles the management of matcher rules.
 */
class RulesController(
  cc: ControllerComponents,
  matcherPool: MatcherPool,
  sheetsRuleManager: SheetsRuleManager,
  bucketRuleManager: BucketRuleManager,
  sheetId: String,
  ruleProvisioner: RuleProvisionerService,
  val publicSettings: PublicSettings
)(implicit ec: ExecutionContext) extends AbstractController(cc) with PandaAuthentication {
  def refresh = ApiAuthAction { implicit request: Request[AnyContent] =>
    sheetsRuleManager.getRules flatMap { ruleResource =>
      val maybeRules = bucketRuleManager.putRules(ruleResource).map { lastModified =>
        (ruleResource, lastModified)
      }
      maybeRules.left.map { error => List(error.getMessage) }
    } match {
      case Right((ruleResource, lastModified)) => {
        ruleProvisioner.updateRules(ruleResource, lastModified)
        val currentRules = matcherPool.getCurrentRules
        Ok(views.html.rules(
            sheetId,
            currentRules,
            matcherPool.getCurrentCategories,
            Some(true),
            Some(currentRules.size),
            Nil
        ))
      }
      case Left(errors) => {
        Ok(views.html.rules(
          sheetId,
          matcherPool.getCurrentRules,
          matcherPool.getCurrentCategories,
          Some(false),
          Some(0),
          errors
        ))
      }
    }
  }

  def rules = ApiAuthAction { implicit request: Request[AnyContent] =>
    Ok(views.html.rules(
      sheetId,
      matcherPool.getCurrentRules,
      matcherPool.getCurrentCategories
    ))
  }
}
