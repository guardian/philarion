package matchers

import model._
import org.scalatest.flatspec.AsyncFlatSpec
import org.scalatest.matchers.should.Matchers
import com.softwaremill.diffx.scalatest.DiffMatcher._
import services.MatcherRequest

class LanguageToolMatcherTest extends AsyncFlatSpec with Matchers {
  val exampleCategory = Category("EXAMPLE_CAT", "Example Category")
  val exampleRuleXml = """
    <pattern>
        <token postag="CD" />
        <token postag="NNS">
            <exception regexp="yes">centuries|decades|years|months|days|hours|minutes|seconds|stars</exception>
        </token>
        <token>or</token>
        <marker>
            <token>less</token>
        </marker>
    </pattern>
    <message>Did you mean <suggestion>fewer</suggestion>? The noun \2 is countable.</message>
    <short>Grammatical error</short>
    <example correction="fewer">Ten items or <marker>less</marker></example>
    <example>It typically takes 30 seconds or <marker>less</marker></example>
    <example>I would only give that hotel 3 stars or <marker>less</marker>.</example>
  """
  val exampleRule =  LTRuleXML(
    "EXAMPLE_RULE",
    exampleRuleXml,
    exampleCategory,
    "An example rule with custom XML"
  )

  "getInstance" should "provide no rules by default" in {
    val ltFactory = new LanguageToolFactory(None)
    val (instance, _) = ltFactory.createInstance(Nil)
    instance.getRules() shouldBe Nil
  }

  "getInstance" should "include the rules we provide by id via `defaultRules`" in {
    val ltFactory = new LanguageToolFactory(None)
    val defaultRules = List("FEWER_LESS", "DOES_YOU")
    val (instance, errors) = ltFactory.createInstance(Nil, defaultRules)
    // These rule ids map to rule groups, which contain two rules each.
    // This is weird, as we'd assume ids to be unique. We may want to alter
    // this to reflect rule groupings to ensure id uniqueness, for example.
    errors shouldBe Nil
    instance.getRules().map(_.id) shouldBe List("FEWER_LESS", "FEWER_LESS", "DOES_YOU", "DOES_YOU")
  }

  "getInstance" should "include the XML-based rules we provide via `rules`" in {
    val ltFactory = new LanguageToolFactory(None)
    val exampleRules = List(exampleRule)
    val (instance, errors) = ltFactory.createInstance(exampleRules)
    errors shouldBe Nil
    instance.getRules().map(_.id) shouldBe List("EXAMPLE_RULE")
  }

  "getInstance" should "handle cases where no novel rules are available" in {
    val ltFactory = new LanguageToolFactory(None)
    val (instance, errors) = ltFactory.createInstance(List.empty)
    instance.getRules().map(_.id) shouldBe List.empty
    errors shouldBe List.empty
  }

  "check" should "apply LanguageTool default rules" in {
    val ltFactory = new LanguageToolFactory(None)
    val defaultRules = List("FEWER_LESS")
    val (instance, _) = ltFactory.createInstance(Nil, defaultRules)
    val request = MatcherRequest(List(TextBlock("id-1", "Three or less tests passed!", 0, 29)))

    val eventuallyMatches = instance.check(request)
    val expectedMatchMessages = List("Did you mean <suggestion>fewer</suggestion>? The noun tests is countable.")
    eventuallyMatches map { matches =>
      matches.map(_.message) shouldBe expectedMatchMessages
    }
  }

  "check" should "apply LanguageTool custom rules" in {
    val ltFactory = new LanguageToolFactory(None)
    val exampleRules = List(exampleRule)
    val (instance, _) = ltFactory.createInstance(List(exampleRule))
    val request = MatcherRequest(List(TextBlock("id-1", "Three mistakes or less", 0, 29)))

    val eventuallyMatches = instance.check(request)
    val expectedMatchMessages = List("Did you mean <suggestion>fewer</suggestion>? The noun mistakes is countable.")
    eventuallyMatches map { matches =>
      matches.map(_.message) shouldBe expectedMatchMessages
    }
  }
}
